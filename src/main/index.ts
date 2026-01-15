import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { checkDependencies, downloadDependencies } from './services/setup'
import { startDownload, cancelDownload, initializeDownloadQueue, killAllDownloads } from './services/downloader'
import { getHistory, clearHistory } from './services/history'
import { getDownloadSettings, updateDownloadSettings, DownloadSettings } from './services/settings'
import { getDownloadQueue } from './services/downloadQueue'

// Platform detection
const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 500,
    show: false,
    // Window icon for Windows
    ...(isWindows ? {
      icon: join(__dirname, '../../resources/icon.ico'),
    } : {}),
    // Platform-specific title bar styling
    ...(isMac ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 15, y: 10 },
    } : {}),
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  // Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' file:;"
        ],
      },
    })
  })

  // Initialize download queue immediately after window creation
  // This must happen before IPC handlers can be called
  initializeDownloadQueue(mainWindow)
  const settings = getDownloadSettings()
  const queue = getDownloadQueue()
  queue.updateConfig({
    maxConcurrent: settings.maxConcurrentDownloads,
    maxRetries: settings.autoRetry ? settings.maxRetries : 0,
    downloadTimeout: settings.downloadTimeout * 1000,
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Set app user model id
  electronApp.setAppUserModelId('com.tuberun.app')

  // Default open or close DevTools by F12 in development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // Check for updates (not in dev mode)
  if (!is.dev) {
    autoUpdater.checkForUpdatesAndNotify()

    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'A new version has been downloaded. Restart now to update?',
        buttons: ['Restart', 'Later']
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
    })

    autoUpdater.on('error', (err) => {
      console.error('Auto-update error:', err)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up download processes before quitting
app.on('before-quit', () => {
  // Kill all active downloads
  killAllDownloads()

  // Clear queue and timers
  const queue = getDownloadQueue()
  queue.clearAllTimers()
  queue.cancelAll()
})

// =====================================
// App IPC Handlers
// =====================================

ipcMain.handle('app:get-version', () => {
  return app.getVersion()
})

ipcMain.handle('app:get-path', (_event, name: string) => {
  return app.getPath(name as any)
})

// =====================================
// Shell IPC Handlers
// =====================================

ipcMain.handle('shell:open-path', async (_event, path: string) => {
  try {
    if (!path || typeof path !== 'string') {
      throw new Error('Invalid path')
    }
    return await shell.openPath(path)
  } catch (error: any) {
    console.error('Failed to open path:', error)
    throw new Error(`Failed to open path: ${error.message}`)
  }
})

ipcMain.handle('shell:show-item-in-folder', async (_event, path: string) => {
  try {
    if (!path || typeof path !== 'string') {
      throw new Error('Invalid path')
    }
    shell.showItemInFolder(path)
  } catch (error: any) {
    console.error('Failed to show item in folder:', error)
    throw new Error(`Failed to show item in folder: ${error.message}`)
  }
})

// =====================================
// Setup IPC Handlers
// =====================================

ipcMain.handle('setup:check-dependencies', async () => {
  return checkDependencies()
})

ipcMain.handle('setup:download-dependencies', async () => {
  if (!mainWindow) {
    throw new Error('No main window')
  }

  await downloadDependencies(mainWindow, (step, percent, status, error) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('setup:progress', {
          step,
          percent,
          status,
          error,
        })
      }
    } catch (err) {
      // Window may have been destroyed between check and send
      console.error('Failed to send setup progress:', err)
    }
  })
})

// =====================================
// Download IPC Handlers
// =====================================

// Validate download options
function validateDownloadOptions(options: unknown): { quality: '128' | '192' | '256' | '320'; speed: number; rateLimit?: number } {
  const validQualities = ['128', '192', '256' , '320'] as const
  const defaults = { quality: '320' as const, speed: 1 }

  if (!options || typeof options !== 'object') {
    return defaults
  }

  const opts = options as Record<string, unknown>
  const quality = validQualities.includes(opts.quality as any)
    ? (opts.quality as '128' | '192' | '256' | '320')
    : defaults.quality
  const speed = typeof opts.speed === 'number' && opts.speed > 0 && opts.speed <= 3
    ? opts.speed
    : defaults.speed

  // Validate rateLimit (KB/s, 0 = unlimited, max 100000 KB/s)
  const rateLimit = typeof opts.rateLimit === 'number' && opts.rateLimit >= 0 && opts.rateLimit <= 100000
    ? opts.rateLimit
    : undefined

  return { quality, speed, rateLimit }
}

ipcMain.handle('download:start', async (_event, url: string, options: unknown) => {
  if (!mainWindow) {
    throw new Error('No main window')
  }

  // Validate URL
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('Invalid URL')
  }

  const validatedOptions = validateDownloadOptions(options)

  // Apply bandwidth limit from settings if not explicitly set
  const settings = getDownloadSettings()
  const downloadOptions = {
    ...validatedOptions,
    rateLimit: validatedOptions.rateLimit ?? settings.bandwidthLimit
  }

  return await startDownload(mainWindow, url, downloadOptions)
})

ipcMain.handle('download:cancel', async (_event, id: string) => {
  cancelDownload(id)
})

// =====================================
// History IPC Handlers
// =====================================

ipcMain.handle('history:get', async () => {
  return getHistory()
})

ipcMain.handle('history:clear', async () => {
  clearHistory()
})

// =====================================
// Settings IPC Handlers
// =====================================

ipcMain.handle('settings:get-download', async () => {
  return getDownloadSettings()
})

ipcMain.handle('settings:update-download', async (_event, settings: Partial<DownloadSettings>) => {
  const updated = updateDownloadSettings(settings)
  // Update queue config when settings change
  const queue = getDownloadQueue()
  queue.updateConfig({
    maxConcurrent: updated.maxConcurrentDownloads,
    maxRetries: updated.autoRetry ? updated.maxRetries : 0,
    downloadTimeout: updated.downloadTimeout * 1000,
  })
  return updated
})

// =====================================
// Queue IPC Handlers
// =====================================

ipcMain.handle('queue:get-status', async () => {
  const queue = getDownloadQueue()
  return queue.getQueueStatus()
})

ipcMain.handle('queue:cancel-all', async () => {
  const queue = getDownloadQueue()
  queue.cancelAll()
})
