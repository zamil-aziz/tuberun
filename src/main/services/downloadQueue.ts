import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'

export interface QueuedDownload {
  id: string
  url: string
  options: DownloadOptions
  status: 'queued' | 'active' | 'paused' | 'completed' | 'error'
  retryCount: number
  maxRetries: number
  addedAt: number
  startedAt?: number
  priority: number
  title?: string
  error?: string
}

export interface DownloadOptions {
  quality: '128' | '192' | '256' | '320'
  speed: number
  outputDir?: string
  rateLimit?: number // KB/s, 0 = unlimited
}

export interface QueueConfig {
  maxConcurrent: number
  maxRetries: number
  retryDelayBase: number // ms
  downloadTimeout: number // ms
  idleTimeout: number // ms
}

export interface QueueStatus {
  totalQueued: number
  activeCount: number
  completedCount: number
  downloads: QueuedDownload[]
}

export interface EnhancedDownloadProgress {
  id: string
  status: 'pending' | 'queued' | 'downloading' | 'converting' | 'complete' | 'error' | 'retrying'
  percent: number
  speed?: string
  speedBps?: number
  eta?: string
  etaSeconds?: number
  title?: string
  error?: string
  outputPath?: string
  retryCount?: number
  maxRetries?: number
  queuePosition?: number
}

type DownloadFunction = (
  id: string,
  url: string,
  options: DownloadOptions,
  outputDir: string,
  onProgress: (progress: EnhancedDownloadProgress) => void,
  config: { maxRetries: number; retryDelayBase: number; timeout: number }
) => Promise<void>

const DEFAULT_CONFIG: QueueConfig = {
  maxConcurrent: 2,
  maxRetries: 3,
  retryDelayBase: 1000,
  downloadTimeout: 300000, // 5 minutes
  idleTimeout: 30000, // 30 seconds
}

export class DownloadQueueManager extends EventEmitter {
  private queue: Map<string, QueuedDownload> = new Map()
  private activeDownloads: Set<string> = new Set()
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map()
  private config: QueueConfig
  private window: BrowserWindow | null = null
  private downloadFn: DownloadFunction | null = null
  private outputDir: string = ''

  constructor(config: Partial<QueueConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  setDownloadFunction(fn: DownloadFunction): void {
    this.downloadFn = fn
  }

  setOutputDir(dir: string): void {
    this.outputDir = dir
  }

  updateConfig(config: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...config }
    // If max concurrent increased, process queue to fill slots
    this.processQueue()
  }

  getConfig(): QueueConfig {
    return { ...this.config }
  }

  add(id: string, url: string, options: DownloadOptions, priority: number = 0): string {
    const download: QueuedDownload = {
      id,
      url,
      options,
      status: 'queued',
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      addedAt: Date.now(),
      priority,
    }

    this.queue.set(id, download)
    this.sendProgress({
      id,
      status: 'queued',
      percent: 0,
      queuePosition: this.getQueuePosition(id),
    })

    // Start processing if we have capacity
    this.processQueue()

    return id
  }

  cancel(id: string): boolean {
    const download = this.queue.get(id)
    if (!download) return false

    if (download.status === 'active') {
      this.activeDownloads.delete(id)
    }

    // Clear any pending cleanup timer
    const timer = this.cleanupTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.cleanupTimers.delete(id)
    }

    this.queue.delete(id)
    this.emit('cancelled', id)

    // Process next in queue
    this.processQueue()

    return true
  }

  cancelAll(): void {
    const ids = Array.from(this.queue.keys())
    for (const id of ids) {
      this.cancel(id)
    }
  }

  pause(id: string): boolean {
    const download = this.queue.get(id)
    if (!download || download.status !== 'queued') return false

    download.status = 'paused'
    return true
  }

  resume(id: string): boolean {
    const download = this.queue.get(id)
    if (!download || download.status !== 'paused') return false

    download.status = 'queued'
    this.processQueue()
    return true
  }

  getQueueStatus(): QueueStatus {
    const downloads = Array.from(this.queue.values())
    return {
      totalQueued: downloads.filter(d => d.status === 'queued').length,
      activeCount: this.activeDownloads.size,
      completedCount: downloads.filter(d => d.status === 'completed').length,
      downloads,
    }
  }

  getDownload(id: string): QueuedDownload | undefined {
    return this.queue.get(id)
  }

  private getQueuePosition(id: string): number {
    const queued = Array.from(this.queue.values())
      .filter(d => d.status === 'queued')
      .sort((a, b) => b.priority - a.priority || a.addedAt - b.addedAt)

    const index = queued.findIndex(d => d.id === id)
    return index >= 0 ? index + 1 : 0
  }

  private processQueue(): void {
    // Start downloads while we have capacity (non-blocking)
    while (this.activeDownloads.size < this.config.maxConcurrent) {
      const next = this.getNextQueuedDownload()
      if (!next) break

      // Mark as active immediately before starting
      next.status = 'active'
      next.startedAt = Date.now()
      this.activeDownloads.add(next.id)

      // Send initial 'downloading' status
      this.sendProgress({
        id: next.id,
        status: 'downloading',
        percent: 0,
        title: next.title,
      })

      // Update queue positions for remaining items
      this.updateQueuePositions()

      // Start download asynchronously (fire-and-forget)
      this.executeDownloadAsync(next)
    }
  }

  private executeDownloadAsync(download: QueuedDownload): void {
    if (!this.downloadFn) {
      console.error('Download function not set')
      this.activeDownloads.delete(download.id)
      download.status = 'error'
      download.error = 'Download function not set'
      return
    }

    this.downloadFn(
      download.id,
      download.url,
      download.options,
      download.options.outputDir || this.outputDir,
      (progress) => this.sendProgress(progress),
      {
        maxRetries: download.maxRetries,
        retryDelayBase: this.config.retryDelayBase,
        timeout: this.config.downloadTimeout,
      }
    )
      .then(() => {
        download.status = 'completed'
      })
      .catch((error: any) => {
        download.status = 'error'
        download.error = error.message
        this.sendProgress({
          id: download.id,
          status: 'error',
          percent: 0,
          error: error.message,
        })
      })
      .finally(() => {
        this.activeDownloads.delete(download.id)

        // Remove completed/errored downloads from queue after a delay
        const cleanupTimer = setTimeout(() => {
          this.cleanupTimers.delete(download.id)
          if (download.status === 'completed' || download.status === 'error') {
            this.queue.delete(download.id)
          }
        }, 5000)
        this.cleanupTimers.set(download.id, cleanupTimer)

        // Process next in queue (may start more downloads if capacity available)
        this.processQueue()
      })
  }

  private getNextQueuedDownload(): QueuedDownload | null {
    const queued = Array.from(this.queue.values())
      .filter(d => d.status === 'queued')
      .sort((a, b) => b.priority - a.priority || a.addedAt - b.addedAt)

    return queued[0] || null
  }

  private updateQueuePositions(): void {
    const queued = Array.from(this.queue.values())
      .filter(d => d.status === 'queued')
      .sort((a, b) => b.priority - a.priority || a.addedAt - b.addedAt)

    queued.forEach((download, index) => {
      this.sendProgress({
        id: download.id,
        status: 'queued',
        percent: 0,
        queuePosition: index + 1,
        title: download.title,
      })
    })
  }

  private sendProgress(progress: EnhancedDownloadProgress): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('download:progress', progress)
    }
    this.emit('progress', progress)
  }
}

// Singleton instance
let queueInstance: DownloadQueueManager | null = null

export function getDownloadQueue(config?: Partial<QueueConfig>): DownloadQueueManager {
  if (!queueInstance) {
    queueInstance = new DownloadQueueManager(config)
  } else if (config) {
    queueInstance.updateConfig(config)
  }
  return queueInstance
}
