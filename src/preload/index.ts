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

  // Download operations (to be implemented)
  startDownload: (url: string, options: DownloadOptions) =>
    ipcRenderer.invoke('download:start', url, options),
  cancelDownload: (id: string) => ipcRenderer.invoke('download:cancel', id),

  // Download progress listener
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, progress: DownloadProgress) => {
      callback(progress)
    }
    ipcRenderer.on('download:progress', subscription)
    return () => {
      ipcRenderer.removeListener('download:progress', subscription)
    }
  },

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
})

// Type definitions for the exposed API
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

interface SetupProgress {
  step: string
  percent: number
  status: 'checking' | 'downloading' | 'complete' | 'error'
  error?: string
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
      onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
      checkDependencies: () => Promise<{ ready: boolean; missing: string[] }>
      downloadDependencies: () => Promise<void>
      onSetupProgress: (callback: (progress: SetupProgress) => void) => () => void
      getHistory: () => Promise<DownloadHistory[]>
      clearHistory: () => Promise<void>
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
