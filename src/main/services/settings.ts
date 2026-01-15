import Store from 'electron-store'

export interface DownloadSettings {
  maxConcurrentDownloads: number  // 1-5, default 2
  maxRetries: number              // 0-5, default 3
  downloadTimeout: number         // seconds, default 300
  bandwidthLimit: number          // KB/s, 0 = unlimited
  autoRetry: boolean              // default true
}

interface SettingsSchema {
  downloads: DownloadSettings
}

const settingsStore = new Store<SettingsSchema>({
  name: 'tuberun-settings',
  defaults: {
    downloads: {
      maxConcurrentDownloads: 2,
      maxRetries: 3,
      downloadTimeout: 300,
      bandwidthLimit: 0,
      autoRetry: true,
    },
  },
})

export function getDownloadSettings(): DownloadSettings {
  return settingsStore.get('downloads')
}

// Clamp a value to a valid range
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// Validate and clamp settings to valid ranges
function validateSettings(settings: Partial<DownloadSettings>): Partial<DownloadSettings> {
  const validated: Partial<DownloadSettings> = {}

  if (settings.maxConcurrentDownloads !== undefined) {
    validated.maxConcurrentDownloads = clamp(Math.round(settings.maxConcurrentDownloads), 1, 5)
  }
  if (settings.maxRetries !== undefined) {
    validated.maxRetries = clamp(Math.round(settings.maxRetries), 0, 10)
  }
  if (settings.downloadTimeout !== undefined) {
    validated.downloadTimeout = clamp(Math.round(settings.downloadTimeout), 60, 600)
  }
  if (settings.bandwidthLimit !== undefined) {
    validated.bandwidthLimit = clamp(Math.round(settings.bandwidthLimit), 0, 100000)
  }
  if (settings.autoRetry !== undefined) {
    validated.autoRetry = Boolean(settings.autoRetry)
  }

  return validated
}

export function updateDownloadSettings(settings: Partial<DownloadSettings>): DownloadSettings {
  const current = getDownloadSettings()
  const validatedSettings = validateSettings(settings)
  const updated = { ...current, ...validatedSettings }
  settingsStore.set('downloads', updated)
  return updated
}

export function resetDownloadSettings(): DownloadSettings {
  const defaults: DownloadSettings = {
    maxConcurrentDownloads: 2,
    maxRetries: 3,
    downloadTimeout: 300,
    bandwidthLimit: 0,
    autoRetry: true,
  }
  settingsStore.set('downloads', defaults)
  return defaults
}
