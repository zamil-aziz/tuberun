import { useState, useEffect } from 'react'

interface DownloadSettings {
  maxConcurrentDownloads: number
  maxRetries: number
  downloadTimeout: number
  bandwidthLimit: number
  autoRetry: boolean
}

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<DownloadSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    let isMounted = true
    setLoading(true)
    setError(null)

    window.api.getDownloadSettings()
      .then((currentSettings) => {
        if (isMounted) {
          setSettings(currentSettings)
        }
      })
      .catch((err) => {
        console.error('Failed to load settings:', err)
        if (isMounted) {
          setError('Failed to load settings')
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [isOpen])

  const handleChange = async <K extends keyof DownloadSettings>(
    key: K,
    value: DownloadSettings[K]
  ) => {
    if (!settings) return

    // Save old value for rollback
    const oldValue = settings[key]
    const updated = { ...settings, [key]: value }
    setSettings(updated)

    try {
      await window.api.updateDownloadSettings({ [key]: value })
    } catch (error) {
      console.error('Failed to update settings:', error)
      // Rollback to old value on error
      setSettings({ ...settings, [key]: oldValue })
    }
  }

  const formatBandwidth = (kbps: number): string => {
    if (kbps === 0) return 'Unlimited'
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} MB/s`
    return `${kbps} KB/s`
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-neutral-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Download Settings</h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
          </div>
        ) : error || !settings ? (
          <div className="flex flex-col items-center justify-center py-8">
            <svg className="w-8 h-8 text-red-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-neutral-400">{error || 'Unable to load settings'}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Simultaneous Downloads */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-neutral-300">
                  Simultaneous Downloads
                </label>
                <span className="text-sm text-primary-400 font-medium">
                  {settings.maxConcurrentDownloads}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                value={settings.maxConcurrentDownloads}
                onChange={(e) => handleChange('maxConcurrentDownloads', parseInt(e.target.value))}
                className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-primary-500"
              />
              <div className="flex justify-between text-xs text-neutral-500 mt-1">
                <span>1</span>
                <span>5</span>
              </div>
            </div>

            {/* Bandwidth Limit */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-neutral-300">
                  Bandwidth Limit
                </label>
                <span className="text-sm text-primary-400 font-medium">
                  {formatBandwidth(settings.bandwidthLimit)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="10000"
                step="500"
                value={settings.bandwidthLimit}
                onChange={(e) => handleChange('bandwidthLimit', parseInt(e.target.value))}
                className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-primary-500"
              />
              <div className="flex justify-between text-xs text-neutral-500 mt-1">
                <span>Unlimited</span>
                <span>10 MB/s</span>
              </div>
            </div>

            {/* Auto Retry Toggle */}
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-neutral-300">Auto-retry failed downloads</span>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Automatically retry on network errors
                </p>
              </div>
              <button
                onClick={() => handleChange('autoRetry', !settings.autoRetry)}
                className={`
                  relative w-11 h-6 rounded-full transition-colors duration-200
                  ${settings.autoRetry ? 'bg-primary-500' : 'bg-neutral-600'}
                `}
              >
                <div
                  className={`
                    absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                    ${settings.autoRetry ? 'translate-x-5' : 'translate-x-0.5'}
                  `}
                />
              </button>
            </div>

            {/* Max Retries (only visible when auto-retry is enabled) */}
            {settings.autoRetry && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-neutral-300">
                    Max Retry Attempts
                  </label>
                  <span className="text-sm text-primary-400 font-medium">
                    {settings.maxRetries}
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={settings.maxRetries}
                  onChange={(e) => handleChange('maxRetries', parseInt(e.target.value))}
                  className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-primary-500"
                />
                <div className="flex justify-between text-xs text-neutral-500 mt-1">
                  <span>1</span>
                  <span>5</span>
                </div>
              </div>
            )}

            {/* Download Timeout */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-neutral-300">
                  Download Timeout
                </label>
                <span className="text-sm text-primary-400 font-medium">
                  {settings.downloadTimeout >= 60
                    ? `${Math.floor(settings.downloadTimeout / 60)} min`
                    : `${settings.downloadTimeout} sec`}
                </span>
              </div>
              <input
                type="range"
                min="60"
                max="600"
                step="30"
                value={settings.downloadTimeout}
                onChange={(e) => handleChange('downloadTimeout', parseInt(e.target.value))}
                className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-primary-500"
              />
              <div className="flex justify-between text-xs text-neutral-500 mt-1">
                <span>1 min</span>
                <span>10 min</span>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full mt-6 py-2.5 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-medium transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  )
}

export default SettingsPanel
