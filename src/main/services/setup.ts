import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, chmodSync, createWriteStream, readdirSync, copyFileSync, unlinkSync, rmSync } from 'fs'
import { pipeline } from 'stream/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import https from 'https'
import extractZip from 'extract-zip'

const execFileAsync = promisify(execFile)

// Platform detection
const isWindows = process.platform === 'win32'
const isArm64 = process.arch === 'arm64'

// Get the TubeRun data directory (platform-specific)
export const TUBERUN_DIR = isWindows
  ? join(app.getPath('appData'), 'TubeRun')
  : join(app.getPath('home'), '.tuberun')

// Binary paths (with .exe extension on Windows)
const EXE_EXT = isWindows ? '.exe' : ''
export const YTDLP_PATH = join(TUBERUN_DIR, `yt-dlp${EXE_EXT}`)
export const FFMPEG_PATH = join(TUBERUN_DIR, `ffmpeg${EXE_EXT}`)

// Download URLs - macOS
const YTDLP_URL_MAC = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
const FFMPEG_URL_MAC = 'https://evermeet.cx/ffmpeg/getrelease/zip'

// Download URLs - Windows
const YTDLP_URL_WIN = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const FFMPEG_URL_WIN = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

// Connection pool for faster downloads
const downloadAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 6,
  maxFreeSockets: 2,
  timeout: 120000,
})

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelayBase: 1000,
  timeout: 120000, // 2 minutes per download
}

// Maximum redirect depth to prevent infinite loops
const MAX_REDIRECTS = 10

// Get platform-specific URLs
function getYtdlpUrl(): string {
  return isWindows ? YTDLP_URL_WIN : YTDLP_URL_MAC
}

function getFfmpegUrl(): string {
  return isWindows ? FFMPEG_URL_WIN : FFMPEG_URL_MAC
}

interface ProgressCallback {
  (step: string, percent: number, status: 'checking' | 'downloading' | 'complete' | 'error', error?: string): void
}

export async function checkDependencies(): Promise<{ ready: boolean; missing: string[] }> {
  const missing: string[] = []

  if (!existsSync(YTDLP_PATH)) {
    missing.push('yt-dlp')
  }

  if (!existsSync(FFMPEG_PATH)) {
    missing.push('ffmpeg')
  }

  return {
    ready: missing.length === 0,
    missing,
  }
}

// Sleep helper for retry delays with jitter
function sleepWithJitter(baseMs: number): Promise<void> {
  const jitter = Math.random() * 0.5 * baseMs
  return new Promise(resolve => setTimeout(resolve, baseMs + jitter))
}

// Validate that a binary can be executed
async function validateBinary(path: string, args: string[] = ['--version']): Promise<boolean> {
  try {
    await execFileAsync(path, args, { timeout: 10000 })
    return true
  } catch {
    return false
  }
}

// Main download function - now downloads in parallel
export async function downloadDependencies(
  _window: BrowserWindow,
  onProgress: ProgressCallback
): Promise<void> {
  // Ensure directory exists
  if (!existsSync(TUBERUN_DIR)) {
    mkdirSync(TUBERUN_DIR, { recursive: true })
  }

  // Track errors for each dependency
  const errors: { name: string; error: string }[] = []

  // Create individual progress handlers
  const createProgressHandler = (step: string) => (percent: number) => {
    onProgress(step, percent, 'downloading')
  }

  // Start all downloads in parallel
  const downloadPromises = [
    downloadYtDlpWithRetry(createProgressHandler('yt-dlp'))
      .then(async () => {
        // Validate the binary works
        const valid = await validateBinary(YTDLP_PATH, ['--version'])
        if (!valid) {
          throw new Error('yt-dlp binary validation failed - file may be corrupted')
        }
        onProgress('yt-dlp', 100, 'complete')
      })
      .catch((error) => {
        errors.push({ name: 'yt-dlp', error: error.message })
        onProgress('yt-dlp', 0, 'error', error.message)
      }),

    downloadFFmpegWithRetry(createProgressHandler('ffmpeg'))
      .then(async () => {
        // Validate the binary works
        const valid = await validateBinary(FFMPEG_PATH, ['-version'])
        if (!valid) {
          throw new Error('FFmpeg binary validation failed - file may be corrupted')
        }
        onProgress('ffmpeg', 100, 'complete')
      })
      .catch((error) => {
        errors.push({ name: 'ffmpeg', error: error.message })
        onProgress('ffmpeg', 0, 'error', error.message)
      }),
  ]

  // Wait for all downloads to complete
  await Promise.allSettled(downloadPromises)

  // Check for failures and report all of them
  if (errors.length > 0) {
    const errorMessages = errors.map(e => `${e.name}: ${e.error}`).join('; ')
    throw new Error(`Failed to setup dependencies: ${errorMessages}`)
  }
}

// Individual download functions with retry logic
async function downloadYtDlpWithRetry(onProgress: (percent: number) => void): Promise<void> {
  return downloadWithRetry({
    url: getYtdlpUrl(),
    destPath: YTDLP_PATH,
    name: 'yt-dlp',
    onProgress,
    postProcess: () => {
      if (!isWindows) {
        chmodSync(YTDLP_PATH, 0o755)
      }
    },
  })
}

async function downloadFFmpegWithRetry(onProgress: (percent: number) => void): Promise<void> {
  const archivePath = join(TUBERUN_DIR, 'ffmpeg.zip')

  await downloadWithRetry({
    url: getFfmpegUrl(),
    destPath: archivePath,
    name: 'ffmpeg',
    onProgress: (p) => onProgress(p * 0.8), // 80% for download
    postProcess: async () => {
      onProgress(80)
      await extractFFmpeg(archivePath)
    },
  })
}

interface DownloadWithRetryOptions {
  url: string
  destPath: string
  name: string
  onProgress: (percent: number) => void
  postProcess?: () => void | Promise<void>
}

async function downloadWithRetry(options: DownloadWithRetryOptions): Promise<void> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = RETRY_CONFIG.retryDelayBase * Math.pow(2, attempt - 1)
        await sleepWithJitter(delay)
      }

      await downloadFileWithTimeout(options.url, options.destPath, options.onProgress)

      // Run post-processing if provided
      if (options.postProcess) {
        await options.postProcess()
      }

      return // Success
    } catch (error: any) {
      lastError = error

      // Check if error is retryable
      if (!isRetryableError(error)) {
        throw error
      }

      // If we've exhausted retries, throw
      if (attempt === RETRY_CONFIG.maxRetries) {
        throw new Error(`Failed to download ${options.name} after ${RETRY_CONFIG.maxRetries + 1} attempts: ${error.message}`)
      }
    }
  }

  throw lastError || new Error(`Failed to download ${options.name}`)
}

function isRetryableError(error: any): boolean {
  const message = error.message || String(error)
  const retryablePatterns = [
    /network/i,
    /timeout/i,
    /ECONNRESET/,
    /ETIMEDOUT/,
    /ENOTFOUND/,
    /socket hang up/i,
    /temporarily unavailable/i,
    /429/,
    /503/,
  ]
  return retryablePatterns.some(p => p.test(message))
}

async function downloadFileWithTimeout(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Set overall timeout
    const timeoutId = setTimeout(() => {
      reject(new Error(`Download timed out after ${RETRY_CONFIG.timeout / 1000}s`))
    }, RETRY_CONFIG.timeout)

    downloadFile(url, destPath, onProgress)
      .then(() => {
        clearTimeout(timeoutId)
        resolve()
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
  })
}

async function downloadFile(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let currentUrl = url
    let redirectCount = 0

    const handleResponse = (response: any) => {
      // Handle redirects (301, 302, 303, 307, 308) with loop protection
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        redirectCount++

        if (redirectCount > MAX_REDIRECTS) {
          reject(new Error(`Too many redirects (${MAX_REDIRECTS}). Possible redirect loop.`))
          return
        }

        const redirectUrl = response.headers.location
        if (!redirectUrl) {
          reject(new Error('Redirect response missing location header'))
          return
        }

        // Resolve relative URLs against the current URL
        const resolvedUrl = new URL(redirectUrl, currentUrl).href
        currentUrl = resolvedUrl
        https.get(resolvedUrl, { agent: downloadAgent }, handleResponse).on('error', reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10)
      let downloadedSize = 0

      const fileStream = createWriteStream(destPath)

      response.on('data', (chunk: Buffer) => {
        downloadedSize += chunk.length
        if (totalSize > 0) {
          const percent = Math.round((downloadedSize / totalSize) * 100)
          onProgress(percent)
        }
      })

      pipeline(response, fileStream)
        .then(() => resolve())
        .catch(reject)
    }

    https.get(url, { agent: downloadAgent }, handleResponse).on('error', reject)
  })
}

async function extractFFmpeg(archivePath: string): Promise<void> {
  const extractDir = join(TUBERUN_DIR, 'ffmpeg-extract')

  // Create extract dir
  if (!existsSync(extractDir)) {
    mkdirSync(extractDir, { recursive: true })
  }

  try {
    // Extract using extract-zip (cross-platform)
    await extractZip(archivePath, { dir: extractDir })

    // Find ffmpeg binary (cross-platform)
    const ffmpegBinary = findFileRecursive(extractDir, isWindows ? 'ffmpeg.exe' : 'ffmpeg')

    if (ffmpegBinary) {
      copyFileSync(ffmpegBinary, FFMPEG_PATH)
      // Make executable on Unix systems
      if (!isWindows) {
        chmodSync(FFMPEG_PATH, 0o755)
      }
    } else {
      throw new Error('FFmpeg binary not found in archive')
    }
  } finally {
    // Cleanup - always try to clean up even if extraction fails
    try {
      rmSync(extractDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    try {
      unlinkSync(archivePath)
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Helper function to recursively find a file by name
function findFileRecursive(dir: string, filename: string): string | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, filename)
        if (found) return found
      } else if (entry.name === filename) {
        return fullPath
      }
    }
  } catch {
    // Ignore directory read errors
  }

  return null
}
