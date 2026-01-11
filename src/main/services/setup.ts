import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, chmodSync, createWriteStream, readdirSync, copyFileSync, unlinkSync, rmSync } from 'fs'
import { pipeline } from 'stream/promises'
import https from 'https'
import extractZip from 'extract-zip'

// Platform detection
const isWindows = process.platform === 'win32'
const isMac = process.platform === 'darwin'
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

export async function downloadDependencies(
  window: BrowserWindow,
  onProgress: ProgressCallback
): Promise<void> {
  // Ensure directory exists
  if (!existsSync(TUBERUN_DIR)) {
    mkdirSync(TUBERUN_DIR, { recursive: true })
  }

  // Download yt-dlp
  onProgress('yt-dlp', 0, 'downloading')
  try {
    await downloadFile(getYtdlpUrl(), YTDLP_PATH, (percent) => {
      onProgress('yt-dlp', percent, 'downloading')
    })
    // Make executable on Unix systems
    if (!isWindows) {
      chmodSync(YTDLP_PATH, 0o755)
    }
    onProgress('yt-dlp', 100, 'complete')
  } catch (error: any) {
    onProgress('yt-dlp', 0, 'error', error.message)
    throw error
  }

  // Download FFmpeg
  onProgress('ffmpeg', 0, 'downloading')
  try {
    const ffmpegArchive = join(TUBERUN_DIR, 'ffmpeg.zip')

    await downloadFile(getFfmpegUrl(), ffmpegArchive, (percent) => {
      onProgress('ffmpeg', percent * 0.8, 'downloading') // 80% for download
    })

    // Extract ffmpeg
    onProgress('ffmpeg', 80, 'downloading')
    await extractFFmpeg(ffmpegArchive)
    onProgress('ffmpeg', 100, 'complete')
  } catch (error: any) {
    onProgress('ffmpeg', 0, 'error', error.message)
    throw error
  }

  // Download Deno
  onProgress('deno', 0, 'downloading')
  try {
    const denoArchive = join(TUBERUN_DIR, 'deno.zip')

    await downloadFile(getDenoUrl(), denoArchive, (percent) => {
      onProgress('deno', percent * 0.8, 'downloading')
    })

    // Extract deno
    onProgress('deno', 80, 'downloading')
    await extractDeno(denoArchive)
    onProgress('deno', 100, 'complete')
  } catch (error: any) {
    onProgress('deno', 0, 'error', error.message)
    throw error
  }
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
        https.get(resolvedUrl, handleResponse).on('error', reject)
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

    https.get(url, handleResponse).on('error', reject)
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
