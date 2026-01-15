import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // App info
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPath: (name: string) => ipcRenderer.invoke('app:get-path', name),

  // Shell operations
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
  showItemInFolder: (path: string) => ipcRenderer.invoke('shell:show-item-in-folder', path),

  // Download operations
  startDownload: (url: string, options: DownloadOptions) =>
    ipcRenderer.invoke('download:start', url, options),
  cancelDownload: (id: string) => ipcRenderer.invoke('download:cancel', id),

  // Download progress listener
  onDownloadProgress: (callback: (progress: EnhancedDownloadProgress) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, progress: EnhancedDownloadProgress) => {
      callback(progress)
    }
    ipcRenderer.on('download:progress', subscription)
    return () => {
      ipcRenderer.removeListener('download:progress', subscription)
    }
  },

  // Queue operations
  getQueueStatus: () => ipcRenderer.invoke('queue:get-status'),
  cancelAllDownloads: () => ipcRenderer.invoke('queue:cancel-all'),

  // Setup operations
  checkDependencies: () => ipcRenderer.invoke('setup:check-dependencies'),
  downloadDependencies: () => ipcRenderer.invoke('setup:download-dependencies'),
  onSetupProgress: (callback: (progress: SetupProgress) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, progress: SetupProgress) => {
      callback(progress)
    }
    ipcRenderer.on('setup:progress', subscription)
    return () => {
      ipcRenderer.removeListener('setup:progress', subscription)
    }
  },

  // History operations
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),

  // Settings operations
  getDownloadSettings: () => ipcRenderer.invoke('settings:get-download'),
  updateDownloadSettings: (settings: Partial<DownloadSettings>) =>
    ipcRenderer.invoke('settings:update-download', settings),
})

// Type definitions for the exposed API
interface DownloadOptions {
  quality: '128' | '192' | '256' | '320'
  speed: number
  outputDir?: string
  rateLimit?: number // KB/s, 0 = unlimited
}

interface EnhancedDownloadProgress {
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

interface SetupProgress {
  step: string
  percent: number
  status: 'checking' | 'downloading' | 'complete' | 'error'
  error?: string
}

interface DownloadSettings {
  maxConcurrentDownloads: number
  maxRetries: number
  downloadTimeout: number
  bandwidthLimit: number
  autoRetry: boolean
}

interface QueuedDownload {
  id: string
  url: string
  status: 'queued' | 'active' | 'paused' | 'completed' | 'error'
  retryCount: number
  maxRetries: number
  addedAt: number
  startedAt?: number
  priority: number
  title?: string
  error?: string
}

interface QueueStatus {
  totalQueued: number
  activeCount: number
  completedCount: number
  downloads: QueuedDownload[]
}

// Type declaration for window.api
declare global {
  interface Window {
    api: {
      getVersion: () => Promise<string>
      getPath: (name: string) => Promise<string>
      openPath: (path: string) => Promise<string>
      showItemInFolder: (path: string) => Promise<void>
      startDownload: (url: string, options: DownloadOptions) => Promise<string>
      cancelDownload: (id: string) => Promise<void>
      onDownloadProgress: (callback: (progress: EnhancedDownloadProgress) => void) => () => void
      getQueueStatus: () => Promise<QueueStatus>
      cancelAllDownloads: () => Promise<void>
      checkDependencies: () => Promise<{ ready: boolean; missing: string[] }>
      downloadDependencies: () => Promise<void>
      onSetupProgress: (callback: (progress: SetupProgress) => void) => () => void
      getHistory: () => Promise<DownloadHistory[]>
      clearHistory: () => Promise<void>
      getDownloadSettings: () => Promise<DownloadSettings>
      updateDownloadSettings: (settings: Partial<DownloadSettings>) => Promise<DownloadSettings>
    }
  }

  interface DownloadHistory {
    id: string
    url: string
    title: string
    outputPath: string
    timestamp: number
  }
}

export {}
