import crypto from 'crypto'
import { app, BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, statfsSync } from 'fs'
import { unlink } from 'fs/promises'
import ffmpeg, { FfmpegCommand } from 'fluent-ffmpeg'
import { YTDLP_PATH, FFMPEG_PATH, TUBERUN_DIR } from './setup'
import { addToHistory } from './history'
import { getDownloadQueue, EnhancedDownloadProgress, DownloadOptions } from './downloadQueue'

// Platform detection
const isWindows = process.platform === 'win32'
const PATH_SEPARATOR = isWindows ? ';' : ':'

// Output directory
const OUTPUT_DIR = join(app.getPath('downloads'), 'TubeRun')

// Minimum required disk space (500MB)
const MIN_DISK_SPACE_BYTES = 500 * 1024 * 1024

// Active download processes (for cancellation)
const activeProcesses = new Map<string, ChildProcess>()

// Active FFmpeg processes (for cancellation during speed adjustment)
const activeFFmpegCommands = new Map<string, FfmpegCommand>()

// Track processed downloads to prevent double-handling
const processedDownloads = new Set<string>()

// Windows reserved filenames
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

// Re-export types
export type { DownloadOptions, EnhancedDownloadProgress }

// Error types for better classification
export enum DownloadErrorType {
  NETWORK = 'network',
  VIDEO_NOT_FOUND = 'video_not_found',
  VIDEO_PRIVATE = 'video_private',
  AGE_RESTRICTED = 'age_restricted',
  RATE_LIMITED = 'rate_limited',
  FFMPEG_ERROR = 'ffmpeg_error',
  DISK_FULL = 'disk_full',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
  UNKNOWN = 'unknown'
}

interface ClassifiedError {
  type: DownloadErrorType
  userMessage: string
  retryable: boolean
}

// Set ffmpeg path
ffmpeg.setFfmpegPath(FFMPEG_PATH)

// Initialize the queue with the download function
export function initializeDownloadQueue(window: BrowserWindow): void {
  const queue = getDownloadQueue()
  queue.setWindow(window)
  queue.setOutputDir(OUTPUT_DIR)
  queue.setDownloadFunction(executeDownloadWithRetry)
}

// Check available disk space
function checkDiskSpace(path: string): { available: number; sufficient: boolean } {
  try {
    const stats = statfsSync(path)
    const available = stats.bavail * stats.bsize
    return {
      available,
      sufficient: available >= MIN_DISK_SPACE_BYTES
    }
  } catch {
    // If we can't check, assume it's sufficient
    return { available: 0, sufficient: true }
  }
}

// Sanitize filename for all platforms
function sanitizeFilename(filename: string): string {
  // Remove/replace invalid characters
  let safe = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')

  // Handle Windows reserved names
  if (isWindows && WINDOWS_RESERVED_NAMES.test(safe.split('.')[0])) {
    safe = '_' + safe
  }

  // Limit length (leaving room for extension and temp suffix)
  safe = safe.substring(0, 80)

  // Remove trailing dots and spaces (Windows issue)
  safe = safe.replace(/[. ]+$/, '')

  // Ensure non-empty
  if (!safe) {
    safe = 'download'
  }

  return safe
}

// Main entry point for starting a download (used by IPC handler)
export async function startDownload(
  _window: BrowserWindow,
  url: string,
  options: DownloadOptions
): Promise<string> {
  const id = crypto.randomUUID()
  const outputDir = options.outputDir || OUTPUT_DIR

  // Ensure output directory exists with error handling
  try {
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }
  } catch (error: any) {
    throw new Error(`Cannot create download directory: ${error.message}`)
  }

  // Check disk space
  const diskSpace = checkDiskSpace(outputDir)
  if (!diskSpace.sufficient) {
    throw new Error(`Insufficient disk space. Need at least 500MB free.`)
  }

  // Add to queue
  const queue = getDownloadQueue()
  queue.add(id, url, { ...options, outputDir })

  return id
}

// Cancel a download
export function cancelDownload(id: string): void {
  // Kill yt-dlp process
  const process = activeProcesses.get(id)
  if (process) {
    // Use SIGKILL on Windows (SIGTERM doesn't work reliably)
    process.kill(isWindows ? 'SIGKILL' : 'SIGTERM')
    activeProcesses.delete(id)
  }

  // Kill FFmpeg process if active
  const ffmpegCommand = activeFFmpegCommands.get(id)
  if (ffmpegCommand) {
    try {
      ffmpegCommand.kill('SIGKILL')
    } catch {
      // Ignore errors when killing FFmpeg
    }
    activeFFmpegCommands.delete(id)
  }

  // Also remove from queue
  const queue = getDownloadQueue()
  queue.cancel(id)
}

// Kill all active download processes (used on app exit)
export function killAllDownloads(): void {
  // Kill all yt-dlp processes
  for (const [id, process] of activeProcesses) {
    try {
      process.kill(isWindows ? 'SIGKILL' : 'SIGTERM')
    } catch {
      // Ignore errors
    }
    activeProcesses.delete(id)
  }

  // Kill all FFmpeg processes
  for (const [id, command] of activeFFmpegCommands) {
    try {
      command.kill('SIGKILL')
    } catch {
      // Ignore errors
    }
    activeFFmpegCommands.delete(id)
  }

  // Clear processed set
  processedDownloads.clear()
}

// Classify errors for better user feedback and retry decisions
function classifyError(error: string): ClassifiedError {
  const patterns: [RegExp, DownloadErrorType, string, boolean][] = [
    [/Video unavailable|not available|This video is unavailable/i, DownloadErrorType.VIDEO_NOT_FOUND,
      'This video is not available or may have been removed', false],
    [/Private video|video is private/i, DownloadErrorType.VIDEO_PRIVATE,
      'This video is private', false],
    [/Sign in to confirm your age|age-restricted/i, DownloadErrorType.AGE_RESTRICTED,
      'This video is age-restricted and cannot be downloaded', false],
    [/429|Too many requests|rate.?limit/i, DownloadErrorType.RATE_LIMITED,
      'YouTube is rate limiting requests. Please try again later', true],
    [/No space left|ENOSPC|disk full/i, DownloadErrorType.DISK_FULL,
      'Not enough disk space to complete download', false],
    [/timed?\s*out|ETIMEDOUT|ESOCKETTIMEDOUT/i, DownloadErrorType.TIMEOUT,
      'The download timed out. Please check your connection and try again', true],
    [/network|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up/i, DownloadErrorType.NETWORK,
      'Network error. Please check your connection and try again', true],
    [/cancelled|aborted|SIGTERM|SIGKILL/i, DownloadErrorType.CANCELLED,
      'Download was cancelled', false],
    [/ffmpeg|encoding|conversion/i, DownloadErrorType.FFMPEG_ERROR,
      'Audio conversion failed', false],
  ]

  for (const [pattern, type, message, retryable] of patterns) {
    if (pattern.test(error)) {
      return { type, userMessage: message, retryable }
    }
  }

  return {
    type: DownloadErrorType.UNKNOWN,
    userMessage: error.length > 200 ? error.substring(0, 200) + '...' : error,
    retryable: false
  }
}

// Sleep helper with jitter for retry delays
function sleepWithJitter(baseMs: number): Promise<void> {
  // Add 0-50% random jitter to prevent thundering herd
  const jitter = Math.random() * 0.5 * baseMs
  return new Promise(resolve => setTimeout(resolve, baseMs + jitter))
}

// Timeout wrapper
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    promise
      .then(result => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch(error => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

// Clean up temp files
async function cleanupTempFiles(outputDir: string, safeTitle: string): Promise<void> {
  const tempFile = join(outputDir, `${safeTitle}_temp.mp3`)
  try {
    if (existsSync(tempFile)) {
      await unlink(tempFile)
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Download with retry logic
async function executeDownloadWithRetry(
  id: string,
  url: string,
  options: DownloadOptions,
  outputDir: string,
  onProgress: (progress: EnhancedDownloadProgress) => void,
  config: { maxRetries: number; retryDelayBase: number; timeout: number }
): Promise<void> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = config.retryDelayBase * Math.pow(2, attempt - 1)
        onProgress({
          id,
          status: 'retrying',
          percent: 0,
          retryCount: attempt,
          maxRetries: config.maxRetries,
        })
        await sleepWithJitter(delay)
      }

      await withTimeout(
        executeDownload(id, url, options, outputDir, onProgress),
        config.timeout,
        'Download'
      )
      return // Success
    } catch (error: any) {
      lastError = error
      const classified = classifyError(error.message || String(error))

      // Don't retry non-retryable errors
      if (!classified.retryable) {
        throw new Error(classified.userMessage)
      }

      // If we've exhausted retries, throw with user-friendly message
      if (attempt === config.maxRetries) {
        throw new Error(classified.userMessage)
      }
    }
  }

  throw lastError || new Error('Download failed after retries')
}

// Map quality option to bitrate
function qualityToBitrate(quality: string): string {
  switch (quality) {
    case '320': return '320k'
    case '256': return '256k'
    case '192': return '192k'
    case '128': return '128k'
    default: return '192k'
  }
}

// Core download execution
async function executeDownload(
  id: string,
  url: string,
  options: DownloadOptions,
  outputDir: string,
  onProgress: (progress: EnhancedDownloadProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Track if this download has been processed
    if (processedDownloads.has(id)) {
      reject(new Error('Download already processed'))
      return
    }

    let hasCompleted = false
    const markComplete = (success: boolean = false) => {
      if (hasCompleted) return false
      hasCompleted = true
      if (success) {
        processedDownloads.add(id)
      }
      return true
    }

    // First, get video info with timeout
    const infoArgs = [
      '--dump-json',
      '--no-download',
      url,
    ]

    const infoProcess = spawn(YTDLP_PATH, infoArgs, {
      env: {
        ...process.env,
        PATH: `${TUBERUN_DIR}${PATH_SEPARATOR}${process.env.PATH}`,
      },
    })

    let infoOutput = ''
    let infoError = ''
    let videoTitle = 'Unknown'
    let infoTimedOut = false
    let safeTitle = 'download'

    // Timeout for info fetch (30 seconds should be plenty for metadata)
    const infoTimeout = setTimeout(() => {
      infoTimedOut = true
      infoProcess.kill(isWindows ? 'SIGKILL' : 'SIGTERM')
    }, 30000)

    infoProcess.stdout.on('data', (data) => {
      infoOutput += data.toString()
    })

    infoProcess.stderr.on('data', (data) => {
      // Cap error string to prevent memory issues
      if (infoError.length < 10000) {
        infoError += data.toString()
      }
    })

    infoProcess.on('close', async (code) => {
      clearTimeout(infoTimeout)

      if (infoTimedOut) {
        if (markComplete()) {
          reject(new Error('Fetching video info timed out. Please try again.'))
        }
        return
      }
      if (code !== 0) {
        if (markComplete()) {
          const errorMsg = infoError || 'Failed to get video info'
          reject(new Error(errorMsg))
        }
        return
      }

      try {
        const info = JSON.parse(infoOutput)
        videoTitle = info.title || 'Unknown'

        onProgress({
          id,
          status: 'downloading',
          percent: 0,
          title: videoTitle,
        })

        // Sanitize filename properly
        safeTitle = sanitizeFilename(videoTitle)
        const tempFile = join(outputDir, `${safeTitle}_temp.%(ext)s`)
        const outputFile = join(outputDir, `${safeTitle}.mp3`)

        // Build download args with optional rate limiting
        const downloadArgs = [
          '-f', 'bestaudio',
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', options.quality === '320' ? '0' : options.quality === '256' ? '1' : options.quality === '192' ? '2' : '4',
          '-o', tempFile,
          '--progress',
          '--newline',
        ]

        // Add rate limiting if specified
        if (options.rateLimit && options.rateLimit > 0) {
          downloadArgs.push('--limit-rate', `${options.rateLimit}K`)
        }

        downloadArgs.push(url)

        const downloadProcess = spawn(YTDLP_PATH, downloadArgs, {
          env: {
            ...process.env,
            PATH: `${TUBERUN_DIR}${PATH_SEPARATOR}${process.env.PATH}`,
            FFMPEG_PATH: FFMPEG_PATH,
          },
        })

        activeProcesses.set(id, downloadProcess)

        downloadProcess.stdout.on('data', (data) => {
          const line = data.toString()
          // Enhanced progress parsing: [download]  45.2% of 5.23MiB at 2.34MiB/s ETA 00:02
          const progressMatch = line.match(
            /(\d+(?:\.\d+)?)%(?:\s+of\s+[\d.]+\w+)?\s+at\s+([\d.]+\s*\w+\/s)(?:\s+ETA\s+(\d+:\d+))?/
          )

          if (progressMatch && progressMatch[1]) {
            const percent = parseFloat(progressMatch[1])
            const speed = progressMatch[2]?.trim() || undefined
            const eta = progressMatch[3] || undefined

            onProgress({
              id,
              status: 'downloading',
              percent: options.speed !== 1 ? percent * 0.7 : percent,
              speed: speed,
              eta: eta,
              title: videoTitle,
            })
          } else {
            // Fallback: just parse percent
            const percentMatch = line.match(/(\d+(?:\.\d+)?)%/)
            if (percentMatch && percentMatch[1]) {
              const percent = parseFloat(percentMatch[1])
              onProgress({
                id,
                status: 'downloading',
                percent: options.speed !== 1 ? percent * 0.7 : percent,
                title: videoTitle,
              })
            }
          }
        })

        let downloadError = ''
        downloadProcess.stderr.on('data', (data) => {
          // Cap error string to prevent memory issues
          if (downloadError.length < 10000) {
            downloadError += data.toString()
          }
        })

        downloadProcess.on('close', async (downloadCode) => {
          activeProcesses.delete(id)

          if (downloadCode !== 0) {
            if (markComplete()) {
              await cleanupTempFiles(outputDir, safeTitle)
              reject(new Error(downloadError || 'Download failed'))
            }
            return
          }

          // Find the downloaded file
          const downloadedFile = join(outputDir, `${safeTitle}_temp.mp3`)

          // If speed adjustment is needed, use ffmpeg
          if (options.speed !== 1 && existsSync(downloadedFile)) {
            onProgress({
              id,
              status: 'converting',
              percent: 70,
              title: videoTitle,
            })

            try {
              await adjustSpeed(
                id,
                downloadedFile,
                outputFile,
                options.speed,
                options.quality,
                (percent) => {
                  onProgress({
                    id,
                    status: 'converting',
                    percent: 70 + percent * 0.3,
                    title: videoTitle,
                  })
                }
              )

              // Remove temp file
              await unlink(downloadedFile)

              // Add to history
              addToHistory({
                id,
                url,
                title: videoTitle,
                outputPath: outputFile,
              })

              if (markComplete(true)) {
                onProgress({
                  id,
                  status: 'complete',
                  percent: 100,
                  title: videoTitle,
                  outputPath: outputFile,
                })
                resolve()
              }
            } catch (err: any) {
              if (markComplete()) {
                // Clean up temp files on failure
                await cleanupTempFiles(outputDir, safeTitle)
                reject(new Error(`Speed adjustment failed: ${err.message}`))
              }
            }
          } else {
            // Rename temp file to final
            if (existsSync(downloadedFile)) {
              const { rename } = await import('fs/promises')
              try {
                await rename(downloadedFile, outputFile)
              } catch (err: any) {
                if (markComplete()) {
                  reject(new Error(`Failed to save file: ${err.message}`))
                }
                return
              }
            }

            // Add to history
            addToHistory({
              id,
              url,
              title: videoTitle,
              outputPath: outputFile,
            })

            if (markComplete(true)) {
              onProgress({
                id,
                status: 'complete',
                percent: 100,
                title: videoTitle,
                outputPath: outputFile,
              })
              resolve()
            }
          }
        })

        downloadProcess.on('error', async (err) => {
          activeProcesses.delete(id)
          if (markComplete()) {
            await cleanupTempFiles(outputDir, safeTitle)
            reject(new Error(`Download process error: ${err.message}`))
          }
        })
      } catch (err: any) {
        if (markComplete()) {
          reject(new Error(`Failed to parse video info: ${err.message}`))
        }
      }
    })

    infoProcess.on('error', (err) => {
      clearTimeout(infoTimeout)
      if (markComplete()) {
        reject(new Error(`Failed to start yt-dlp: ${err.message}`))
      }
    })
  })
}

function adjustSpeed(
  id: string,
  inputFile: string,
  outputFile: string,
  speed: number,
  quality: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Calculate atempo value (ffmpeg atempo accepts 0.5 to 2.0)
    // For speeds > 2, we need to chain multiple atempo filters
    const atempoFilters: string[] = []
    let remainingSpeed = speed

    while (remainingSpeed > 2.0) {
      atempoFilters.push('atempo=2.0')
      remainingSpeed /= 2.0
    }
    if (remainingSpeed > 0.5) {
      atempoFilters.push(`atempo=${remainingSpeed}`)
    }

    const filterString = atempoFilters.join(',')

    let duration = 0

    const command = ffmpeg(inputFile)
      .audioFilters(filterString)
      .audioBitrate(qualityToBitrate(quality))
      .on('codecData', (data) => {
        // Parse duration with validation
        if (data.duration) {
          duration = parseDuration(data.duration)
        }
      })
      .on('progress', (progress) => {
        if (duration > 0 && progress.timemark) {
          const currentTime = parseTimemark(progress.timemark)
          const percent = Math.min((currentTime / duration) * 100, 100)
          onProgress(percent)
        }
      })
      .on('end', () => {
        activeFFmpegCommands.delete(id)
        resolve()
      })
      .on('error', (err) => {
        activeFFmpegCommands.delete(id)
        reject(err)
      })

    // Track FFmpeg command for cancellation
    activeFFmpegCommands.set(id, command)

    command.save(outputFile)
  })
}

// Parse duration string with validation
function parseDuration(duration: string): number {
  if (!duration || typeof duration !== 'string') {
    return 0
  }

  const parts = duration.split(':')

  // Handle different formats
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0
    const minutes = parseFloat(parts[1]) || 0
    const seconds = parseFloat(parts[2]) || 0
    return hours * 3600 + minutes * 60 + seconds
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0
    const seconds = parseFloat(parts[1]) || 0
    return minutes * 60 + seconds
  } else if (parts.length === 1) {
    return parseFloat(parts[0]) || 0
  }

  return 0
}

function parseTimemark(timemark: string): number {
  if (!timemark || typeof timemark !== 'string') {
    return 0
  }
  return parseDuration(timemark)
}
