import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, chmodSync, createWriteStream, readdirSync, copyFileSync, unlinkSync, rmSync } from 'fs'
import { pipeline } from 'stream/promises'
import https from 'https'
import extractZip from 'extract-zip'

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
export const DENO_PATH = join(TUBERUN_DIR, `deno${EXE_EXT}`)

// Download URLs - macOS
const YTDLP_URL_MAC = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
const FFMPEG_URL_MAC = 'https://evermeet.cx/ffmpeg/getrelease/zip'
const DENO_URL_MAC_ARM64 = 'https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip'
const DENO_URL_MAC_X64 = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip'

// Download URLs - Windows
const YTDLP_URL_WIN = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const FFMPEG_URL_WIN = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
const DENO_URL_WIN_X64 = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'

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

// Get platform-specific URLs
function getYtdlpUrl(): string {
  return isWindows ? YTDLP_URL_WIN : YTDLP_URL_MAC
}

function getFfmpegUrl(): string {
  return isWindows ? FFMPEG_URL_WIN : FFMPEG_URL_MAC
}

function getDenoUrl(): string {
  if (isWindows) return DENO_URL_WIN_X64
  return isArm64 ? DENO_URL_MAC_ARM64 : DENO_URL_MAC_X64
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

  if (!existsSync(DENO_PATH)) {
    missing.push('deno')
  }

  return {
    ready: missing.length === 0,
    missing,
  }
}

// Sleep helper for retry delays
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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

  // Track individual progress for combined display
  const progressState = new Map<string, number>([
    ['yt-dlp', 0],
    ['ffmpeg', 0],
    ['deno', 0],
  ])

  // Create individual progress handlers
  const createProgressHandler = (step: string) => (percent: number) => {
    progressState.set(step, percent)
    onProgress(step, percent, 'downloading')
  }

  // Start all downloads in parallel
  const downloadPromises = [
    downloadYtDlpWithRetry(createProgressHandler('yt-dlp'))
      .then(() => {
        onProgress('yt-dlp', 100, 'complete')
      })
      .catch((error) => {
        onProgress('yt-dlp', 0, 'error', error.message)
        throw error
      }),

    downloadFFmpegWithRetry(createProgressHandler('ffmpeg'))
      .then(() => {
        onProgress('ffmpeg', 100, 'complete')
      })
      .catch((error) => {
        onProgress('ffmpeg', 0, 'error', error.message)
        throw error
      }),

    downloadDenoWithRetry(createProgressHandler('deno'))
      .then(() => {
        onProgress('deno', 100, 'complete')
      })
      .catch((error) => {
        onProgress('deno', 0, 'error', error.message)
        throw error
      }),
  ]

  // Wait for all downloads to complete
  const results = await Promise.allSettled(downloadPromises)

  // Check for failures
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    throw failures[0].reason
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

async function downloadDenoWithRetry(onProgress: (percent: number) => void): Promise<void> {
  const archivePath = join(TUBERUN_DIR, 'deno.zip')

  await downloadWithRetry({
    url: getDenoUrl(),
    destPath: archivePath,
    name: 'deno',
    onProgress: (p) => onProgress(p * 0.8),
    postProcess: async () => {
      onProgress(80)
      await extractDeno(archivePath)
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
        await sleep(delay)
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

    const handleResponse = (response: any) => {
      // Handle redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const redirectUrl = response.headers.location
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
  }

  // Cleanup
  rmSync(extractDir, { recursive: true, force: true })
  unlinkSync(archivePath)
}

async function extractDeno(archivePath: string): Promise<void> {
  // Extract using extract-zip (cross-platform)
  await extractZip(archivePath, { dir: TUBERUN_DIR })

  // Make executable on Unix systems
  if (!isWindows) {
    chmodSync(DENO_PATH, 0o755)
  }

  // Cleanup
  unlinkSync(archivePath)
}

// Helper function to recursively find a file by name
function findFileRecursive(dir: string, filename: string): string | null {
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

  return null
}
