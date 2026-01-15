import { useState, useEffect, useRef } from 'react'
import URLInput from './components/URLInput'
import SpeedSelector from './components/SpeedSelector'
import QualitySelector from './components/QualitySelector'
import DownloadButton from './components/DownloadButton'
import ProgressBar from './components/ProgressBar'
import AudioPlayer from './components/AudioPlayer'
import HistoryList from './components/HistoryList'
import SetupProgress from './components/SetupProgress'
import SettingsPanel from './components/SettingsPanel'

interface DownloadState {
  id: string
  status: 'queued' | 'downloading' | 'converting' | 'complete' | 'error' | 'retrying'
  percent: number
  title: string
  outputPath: string | null
  error: string | null
  speed?: string
  eta?: string
  queuePosition?: number
  retryCount?: number
  maxRetries?: number
}

function App() {
  const [isReady, setIsReady] = useState(false)
  const [isSetupInProgress, setIsSetupInProgress] = useState(false)
  const [url, setUrl] = useState('')
  const [speed, setSpeed] = useState(1)
  const [quality, setQuality] = useState<'128' | '192' | '256' | '320'>('320')
  const [downloads, setDownloads] = useState<Map<string, DownloadState>>(new Map())
  const [showSettings, setShowSettings] = useState(false)
  // Track downloads scheduled for removal to prevent duplicate timeouts
  const pendingRemovalRef = useRef<Set<string>>(new Set())
  // Track timeout IDs for cleanup on unmount
  const pendingTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Check dependencies on mount
  useEffect(() => {
    checkSetup()
  }, [])

  // Listen for download progress
  useEffect(() => {
    const unsubscribe = window.api.onDownloadProgress((progress) => {
      setDownloads((prev) => {
        const updated = new Map(prev)

        if (progress.status === 'complete' || progress.status === 'error') {
          // Keep completed/error downloads for a short time then remove
          updated.set(progress.id, {
            id: progress.id,
            status: progress.status,
            percent: progress.percent,
            title: progress.title || '',
            outputPath: progress.outputPath || null,
            error: progress.error || null,
            speed: progress.speed,
            eta: progress.eta,
            queuePosition: progress.queuePosition,
            retryCount: progress.retryCount,
            maxRetries: progress.maxRetries,
          })

          // Remove after 5 seconds (only schedule once per download)
          if (!pendingRemovalRef.current.has(progress.id)) {
            pendingRemovalRef.current.add(progress.id)
            const timeoutId = setTimeout(() => {
              pendingRemovalRef.current.delete(progress.id)
              pendingTimeoutsRef.current.delete(progress.id)
              setDownloads((current) => {
                const next = new Map(current)
                next.delete(progress.id)
                return next
              })
            }, 5000)
            pendingTimeoutsRef.current.set(progress.id, timeoutId)
          }
        } else {
          // Map progress status to download state status
          const mapStatus = (status: string): DownloadState['status'] => {
            if (status === 'pending' || status === 'queued') return 'queued'
            if (status === 'downloading') return 'downloading'
            if (status === 'converting') return 'converting'
            if (status === 'retrying') return 'retrying'
            if (status === 'complete') return 'complete'
            if (status === 'error') return 'error'
            return 'queued'
          }

          updated.set(progress.id, {
            id: progress.id,
            status: mapStatus(progress.status),
            percent: progress.percent,
            title: progress.title || '',
            outputPath: progress.outputPath || null,
            error: progress.error || null,
            speed: progress.speed,
            eta: progress.eta,
            queuePosition: progress.queuePosition,
            retryCount: progress.retryCount,
            maxRetries: progress.maxRetries,
          })
        }

        return updated
      })
    })

    // Cleanup: unsubscribe and clear all pending timeouts
    return () => {
      unsubscribe()
      pendingTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId))
      pendingTimeoutsRef.current.clear()
      pendingRemovalRef.current.clear()
    }
  }, [])

  const checkSetup = async () => {
    try {
      const result = await window.api.checkDependencies()
      if (result.ready) {
        setIsReady(true)
      } else {
        setIsSetupInProgress(true)
      }
    } catch (error) {
      console.error('Failed to check dependencies:', error)
      setIsSetupInProgress(true)
    }
  }

  const handleSetupComplete = () => {
    setIsSetupInProgress(false)
    setIsReady(true)
  }

  const handleDownload = async () => {
    if (!url.trim()) return

    try {
      await window.api.startDownload(url, { quality, speed })
      setUrl('') // Clear for next URL immediately
    } catch (error: any) {
      console.error('Download error:', error)
    }
  }

  const handleCancel = async (id: string) => {
    await window.api.cancelDownload(id)
    setDownloads((prev) => {
      const updated = new Map(prev)
      updated.delete(id)
      return updated
    })
  }

  const handleShowInFinder = (outputPath: string) => {
    window.api.showItemInFolder(outputPath)
  }

  // Get active downloads (not complete/error)
  const activeDownloads = Array.from(downloads.values()).filter(
    (d) => d.status !== 'complete' && d.status !== 'error'
  )

  // Get completed downloads
  const completedDownloads = Array.from(downloads.values()).filter(
    (d) => d.status === 'complete'
  )

  // Get any error downloads
  const errorDownloads = Array.from(downloads.values()).filter(
    (d) => d.status === 'error'
  )

  // Determine if we're in idle state (no downloads at all)
  const isIdle = downloads.size === 0

  // Show setup screen if dependencies are missing
  if (isSetupInProgress) {
    return <SetupProgress onComplete={handleSetupComplete} />
  }

  // Main app UI
  return (
    <div className="min-h-screen bg-neutral-900 text-white">
      {/* Title bar drag region */}
      <div className="drag-region h-8 bg-neutral-900 flex items-center justify-end pr-4">
        <button
          onClick={() => setShowSettings(true)}
          className="text-neutral-500 hover:text-white transition-colors p-1"
          title="Settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-4">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-1">TubeRun</h1>
          <p className="text-neutral-400 text-sm">YouTube to MP3 converter</p>
        </div>

        {/* Main content */}
        <div className="space-y-6">
          {/* URL Input - always visible */}
          <URLInput
            value={url}
            onChange={setUrl}
            disabled={false}
          />

          {/* Options - always visible when idle or can start new download */}
          {(isIdle || activeDownloads.length < 5) && (
            <div className="flex gap-4">
              <SpeedSelector value={speed} onChange={setSpeed} />
              <QualitySelector value={quality} onChange={setQuality} />
            </div>
          )}

          {/* Download button */}
          <DownloadButton
            onClick={handleDownload}
            disabled={!url.trim() || !isReady}
          />

          {/* Active downloads */}
          {activeDownloads.length > 0 && (
            <div className="space-y-4">
              {activeDownloads.map((download) => (
                <div key={download.id} className="bg-neutral-800/50 rounded-lg p-4">
                  <ProgressBar
                    percent={download.percent}
                    status={download.status as 'queued' | 'downloading' | 'converting' | 'retrying'}
                    title={download.title}
                    speed={download.speed}
                    eta={download.eta}
                    queuePosition={download.queuePosition}
                    retryInfo={
                      download.retryCount && download.maxRetries
                        ? { current: download.retryCount, max: download.maxRetries }
                        : undefined
                    }
                    onCancel={() => handleCancel(download.id)}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Completed downloads */}
          {completedDownloads.map((download) => (
            <div key={download.id} className="space-y-4">
              <div className="text-center">
                <div className="inline-flex items-center gap-2 text-green-400 mb-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Download complete!</span>
                </div>
                <p className="text-neutral-400 text-sm truncate">{download.title}</p>
              </div>

              {/* Audio player */}
              {download.outputPath && (
                <AudioPlayer src={`file://${download.outputPath}`} />
              )}

              {/* Actions */}
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => download.outputPath && handleShowInFinder(download.outputPath)}
                  className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm transition-colors"
                >
                  Reveal in Finder
                </button>
              </div>
            </div>
          ))}

          {/* Error downloads */}
          {errorDownloads.map((download) => (
            <div key={download.id} className="space-y-4">
              <div className="text-center">
                <div className="inline-flex items-center gap-2 text-red-400 mb-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>Download failed</span>
                </div>
                <p className="text-neutral-400 text-sm">{download.error}</p>
              </div>
            </div>
          ))}
        </div>

        {/* History (shown when no active downloads) */}
        {activeDownloads.length === 0 && (
          <div className="mt-12">
            <HistoryList />
          </div>
        )}
      </div>

      {/* Settings Panel */}
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}

export default App
