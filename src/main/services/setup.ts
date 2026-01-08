import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, chmodSync, createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { exec } from 'child_process'
import { promisify } from 'util'
import https from 'https'

const execAsync = promisify(exec)

// Get the TubeRun data directory
export const TUBERUN_DIR = join(app.getPath('home'), '.tuberun')

// Binary paths
export const YTDLP_PATH = join(TUBERUN_DIR, 'yt-dlp')
export const FFMPEG_PATH = join(TUBERUN_DIR, 'ffmpeg')
export const DENO_PATH = join(TUBERUN_DIR, 'deno')

// Download URLs (macOS)
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
const FFMPEG_URL = 'https://evermeet.cx/ffmpeg/getrelease/zip'
const DENO_URL_ARM64 = 'https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip'
const DENO_URL_X64 = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip'

// Detect architecture
const isArm64 = process.arch === 'arm64'

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
    await downloadFile(YTDLP_URL, YTDLP_PATH, (percent) => {
      onProgress('yt-dlp', percent, 'downloading')
    })
    chmodSync(YTDLP_PATH, 0o755)
    onProgress('yt-dlp', 100, 'complete')
  } catch (error: any) {
    onProgress('yt-dlp', 0, 'error', error.message)
    throw error
  }

  // Download FFmpeg
  onProgress('ffmpeg', 0, 'downloading')
  try {
    const ffmpegArchive = join(TUBERUN_DIR, 'ffmpeg.zip')

    await downloadFile(FFMPEG_URL, ffmpegArchive, (percent) => {
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
    const denoUrl = isArm64 ? DENO_URL_ARM64 : DENO_URL_X64
    const denoArchive = join(TUBERUN_DIR, 'deno.zip')

    await downloadFile(denoUrl, denoArchive, (percent) => {
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
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
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
  // Extract zip and find ffmpeg binary
  const extractDir = join(TUBERUN_DIR, 'ffmpeg-extract')

  // Create extract dir
  if (!existsSync(extractDir)) {
    mkdirSync(extractDir, { recursive: true })
  }

  // Extract using unzip
  await execAsync(`unzip -o "${archivePath}" -d "${extractDir}"`)

  // Find and copy ffmpeg binary
  const { stdout } = await execAsync(`find "${extractDir}" -name "ffmpeg" -type f`)
  const ffmpegBinary = stdout.trim().split('\n')[0]

  if (ffmpegBinary) {
    await execAsync(`cp "${ffmpegBinary}" "${FFMPEG_PATH}"`)
    chmodSync(FFMPEG_PATH, 0o755)
  }

  // Cleanup
  await execAsync(`rm -rf "${extractDir}" "${archivePath}"`)
}

async function extractDeno(archivePath: string): Promise<void> {
  // Extract zip
  await execAsync(`unzip -o "${archivePath}" -d "${TUBERUN_DIR}"`)
  chmodSync(DENO_PATH, 0o755)

  // Cleanup
  await execAsync(`rm -f "${archivePath}"`)
}
