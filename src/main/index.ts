import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { checkDependencies, downloadDependencies } from './services/setup'
import { startDownload, cancelDownload } from './services/downloader'
import { getHistory, addToHistory, clearHistory } from './services/history'

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
  return shell.openPath(path)
})

ipcMain.handle('shell:show-item-in-folder', (_event, path: string) => {
  shell.showItemInFolder(path)
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
    mainWindow?.webContents.send('setup:progress', {
      step,
      percent,
      status,
      error,
    })
  })
})

// =====================================
// Download IPC Handlers
// =====================================

ipcMain.handle('download:start', async (_event, url: string, options: any) => {
  if (!mainWindow) {
    throw new Error('No main window')
  }

  const id = await startDownload(mainWindow, url, options)

  // Listen for completion to add to history
  const progressHandler = (_e: any, progress: any) => {
    if (progress.id === id && progress.status === 'complete') {
      addToHistory({
        id,
        url,
        title: progress.title,
        outputPath: progress.outputPath,
      })
      mainWindow?.webContents.removeListener('download:progress', progressHandler)
    }
  }

  // We need to set up a listener differently since we're in main process
  // The history is added in the downloader service instead

  return id
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
