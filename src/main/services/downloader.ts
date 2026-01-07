import { app, BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import { YTDLP_PATH, FFMPEG_PATH, TUBERUN_DIR } from './setup'
import { addToHistory } from './history'

// Output directory
const OUTPUT_DIR = join(app.getPath('downloads'), 'TubeRun')

// Active downloads
const activeDownloads = new Map<string, ChildProcess>()

interface DownloadOptions {
  quality: '128' | '192' | '256' | '320'
  speed: number
  outputDir?: string
}

interface DownloadProgress {
  id: string
  status: 'pending' | 'downloading' | 'converting' | 'complete' | 'error'
  percent: number
  speed?: string
  eta?: string
  title?: string
  error?: string
  outputPath?: string
}

// Set ffmpeg path
ffmpeg.setFfmpegPath(FFMPEG_PATH)

export async function startDownload(
  window: BrowserWindow,
  url: string,
  options: DownloadOptions
): Promise<string> {
  const id = crypto.randomUUID()
  const outputDir = options.outputDir || OUTPUT_DIR

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Progress callback
  const sendProgress = (progress: DownloadProgress) => {
    if (!window.isDestroyed()) {
      window.webContents.send('download:progress', progress)
    }
  }

  // Start download process
  downloadWithYtDlp(id, url, options, outputDir, sendProgress)
    .catch((error) => {
      sendProgress({
        id,
        status: 'error',
        percent: 0,
        error: error.message,
      })
    })

  return id
}

export function cancelDownload(id: string): void {
  const process = activeDownloads.get(id)
  if (process) {
    // Kill the process and all its children
    process.kill('SIGTERM')
    activeDownloads.delete(id)
  }
}

async function downloadWithYtDlp(
  id: string,
  url: string,
  options: DownloadOptions,
  outputDir: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    // First, get video info
    const infoArgs = [
      '--dump-json',
      '--no-download',
      url,
    ]

    const infoProcess = spawn(YTDLP_PATH, infoArgs, {
      env: {
        ...process.env,
        PATH: `${join(TUBERUN_DIR)}:${process.env.PATH}`,
      },
    })

    let infoOutput = ''
    let videoTitle = 'Unknown'

    infoProcess.stdout.on('data', (data) => {
      infoOutput += data.toString()
    })

    infoProcess.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('Failed to get video info'))
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

        // Sanitize filename
        const safeTitle = videoTitle.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100)
        const tempFile = join(outputDir, `${safeTitle}_temp.%(ext)s`)
        const outputFile = join(outputDir, `${safeTitle}.mp3`)

        // Download audio
        const downloadArgs = [
          '-f', 'bestaudio',
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', options.quality === '320' ? '0' : options.quality === '256' ? '1' : options.quality === '192' ? '2' : '4',
          '-o', tempFile,
          '--progress',
          '--newline',
          url,
        ]

        const downloadProcess = spawn(YTDLP_PATH, downloadArgs, {
          env: {
            ...process.env,
            PATH: `${join(TUBERUN_DIR)}:${process.env.PATH}`,
            FFMPEG_PATH: FFMPEG_PATH,
          },
        })

        activeDownloads.set(id, downloadProcess)

        downloadProcess.stdout.on('data', (data) => {
          const line = data.toString()
          // Parse progress from yt-dlp output
          const percentMatch = line.match(/(\d+(?:\.\d+)?)%/)
          if (percentMatch) {
            const percent = parseFloat(percentMatch[1])
            onProgress({
              id,
              status: 'downloading',
              percent: options.speed !== 1 ? percent * 0.7 : percent, // Reserve 30% for speed conversion
              title: videoTitle,
            })
          }
        })

        downloadProcess.stderr.on('data', (data) => {
          console.error('yt-dlp stderr:', data.toString())
        })

        downloadProcess.on('close', async (downloadCode) => {
          activeDownloads.delete(id)

          if (downloadCode !== 0) {
            reject(new Error('Download failed'))
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
              await adjustSpeed(downloadedFile, outputFile, options.speed, (percent) => {
                onProgress({
                  id,
                  status: 'converting',
                  percent: 70 + percent * 0.3,
                  title: videoTitle,
                })
              })

              // Remove temp file
              const { unlink } = await import('fs/promises')
              await unlink(downloadedFile)

              // Add to history
              addToHistory({
                id,
                url,
                title: videoTitle,
                outputPath: outputFile,
              })

              onProgress({
                id,
                status: 'complete',
                percent: 100,
                title: videoTitle,
                outputPath: outputFile,
              })
              resolve()
            } catch (err: any) {
              reject(new Error(`Speed adjustment failed: ${err.message}`))
            }
          } else {
            // Rename temp file to final
            if (existsSync(downloadedFile)) {
              const { rename } = await import('fs/promises')
              await rename(downloadedFile, outputFile)
            }

            // Add to history
            addToHistory({
              id,
              url,
              title: videoTitle,
              outputPath: outputFile,
            })

            onProgress({
              id,
              status: 'complete',
              percent: 100,
              title: videoTitle,
              outputPath: outputFile,
            })
            resolve()
          }
        })
      } catch (err: any) {
        reject(new Error(`Failed to parse video info: ${err.message}`))
      }
    })

    infoProcess.on('error', (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`))
    })
  })
}

function adjustSpeed(
  inputFile: string,
  outputFile: string,
  speed: number,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Calculate atempo value (ffmpeg atempo accepts 0.5 to 2.0)
    // For speeds > 2, we need to chain multiple atempo filters
    let atempoFilters: string[] = []
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

    ffmpeg(inputFile)
      .audioFilters(filterString)
      .audioBitrate('320k')
      .on('codecData', (data) => {
        // Parse duration
        const parts = data.duration.split(':')
        duration = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
      })
      .on('progress', (progress) => {
        if (duration > 0) {
          const percent = Math.min((progress.timemark ? parseTimemark(progress.timemark) / duration : 0) * 100, 100)
          onProgress(percent)
        }
      })
      .on('end', () => {
        resolve()
      })
      .on('error', (err) => {
        reject(err)
      })
      .save(outputFile)
  })
}

function parseTimemark(timemark: string): number {
  const parts = timemark.split(':')
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
  }
  return 0
}
