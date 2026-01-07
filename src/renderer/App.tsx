import { useState, useEffect } from 'react'
import URLInput from './components/URLInput'
import SpeedSelector from './components/SpeedSelector'
import QualitySelector from './components/QualitySelector'
import DownloadButton from './components/DownloadButton'
import ProgressBar from './components/ProgressBar'
import AudioPlayer from './components/AudioPlayer'
import HistoryList from './components/HistoryList'
import SetupProgress from './components/SetupProgress'

interface DownloadState {
  id: string | null
  status: 'idle' | 'downloading' | 'converting' | 'complete' | 'error'
  percent: number
  title: string
  outputPath: string | null
  error: string | null
}

function App() {
  const [isReady, setIsReady] = useState(false)
  const [isSetupInProgress, setIsSetupInProgress] = useState(false)
  const [url, setUrl] = useState('')
  const [speed, setSpeed] = useState(1)
  const [quality, setQuality] = useState<'128' | '192' | '256' | '320'>('320')
  const [download, setDownload] = useState<DownloadState>({
    id: null,
    status: 'idle',
    percent: 0,
    title: '',
    outputPath: null,
    error: null,
  })

  // Check dependencies on mount
  useEffect(() => {
    checkSetup()
  }, [])

  // Listen for download progress
  useEffect(() => {
    const unsubscribe = window.api.onDownloadProgress((progress) => {
      setDownload({
        id: progress.id,
        status: progress.status === 'pending' ? 'idle' : progress.status as any,
        percent: progress.percent,
        title: progress.title || '',
        outputPath: progress.outputPath || null,
        error: progress.error || null,
      })
    })
    return unsubscribe
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
      setDownload({
        id: null,
        status: 'downloading',
        percent: 0,
        title: 'Fetching video info...',
        outputPath: null,
        error: null,
      })

      await window.api.startDownload(url, { quality, speed })
    } catch (error: any) {
      setDownload((prev) => ({
        ...prev,
        status: 'error',
        error: error.message || 'Download failed',
      }))
    }
  }

  const handleCancel = async () => {
    if (download.id) {
      await window.api.cancelDownload(download.id)
      setDownload({
        id: null,
        status: 'idle',
        percent: 0,
        title: '',
        outputPath: null,
        error: null,
      })
    }
  }

  const handleShowInFinder = () => {
    if (download.outputPath) {
      window.api.showItemInFolder(download.outputPath)
    }
  }

  const handleNewDownload = () => {
    setUrl('')
    setDownload({
      id: null,
      status: 'idle',
      percent: 0,
      title: '',
      outputPath: null,
      error: null,
    })
  }

  // Show setup screen if dependencies are missing
  if (isSetupInProgress) {
    return <SetupProgress onComplete={handleSetupComplete} />
  }

  // Main app UI
  return (
    <div className="min-h-screen bg-neutral-900 text-white">
      {/* Title bar drag region */}
      <div className="drag-region h-8 bg-neutral-900" />

      <div className="max-w-2xl mx-auto px-6 py-4">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-1">TubeRun</h1>
          <p className="text-neutral-400 text-sm">YouTube to MP3 converter</p>
        </div>

        {/* Main content */}
        <div className="space-y-6">
          {/* URL Input */}
          <URLInput
            value={url}
            onChange={setUrl}
            disabled={download.status !== 'idle'}
          />

          {/* Options */}
          {download.status === 'idle' && (
            <div className="flex gap-4">
              <SpeedSelector value={speed} onChange={setSpeed} />
              <QualitySelector value={quality} onChange={setQuality} />
            </div>
          )}

          {/* Download button or progress */}
          {download.status === 'idle' ? (
            <DownloadButton
              onClick={handleDownload}
              disabled={!url.trim() || !isReady}
            />
          ) : download.status === 'complete' ? (
            <div className="space-y-4">
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
                  onClick={handleShowInFinder}
                  className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm transition-colors"
                >
                  Reveal in Finder
                </button>
                <button
                  onClick={handleNewDownload}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg text-sm transition-colors"
                >
                  New Download
                </button>
              </div>
            </div>
          ) : download.status === 'error' ? (
            <div className="space-y-4">
              <div className="text-center">
                <div className="inline-flex items-center gap-2 text-red-400 mb-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>Download failed</span>
                </div>
                <p className="text-neutral-400 text-sm">{download.error}</p>
              </div>
              <button
                onClick={handleNewDownload}
                className="w-full px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : (
            <ProgressBar
              percent={download.percent}
              status={download.status}
              title={download.title}
              onCancel={handleCancel}
            />
          )}
        </div>

        {/* History (shown when idle) */}
        {download.status === 'idle' && (
          <div className="mt-12">
            <HistoryList />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
