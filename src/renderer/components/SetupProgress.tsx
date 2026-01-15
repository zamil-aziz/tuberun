import { useState, useEffect, useRef } from 'react'

interface SetupProgressProps {
  onComplete: () => void
}

interface SetupStep {
  id: string
  label: string
  status: 'pending' | 'checking' | 'downloading' | 'complete' | 'error'
}

function SetupProgress({ onComplete }: SetupProgressProps) {
  const [steps, setSteps] = useState<SetupStep[]>([
    { id: 'yt-dlp', label: 'yt-dlp', status: 'pending' },
    { id: 'ffmpeg', label: 'FFmpeg', status: 'pending' },
  ])
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    startSetup()

    const unsubscribe = window.api.onSetupProgress((progress) => {
      setCurrentStep(progress.step)
      setPercent(progress.percent)

      setSteps((prev) =>
        prev.map((step) => {
          if (step.id === progress.step) {
            return { ...step, status: progress.status }
          }
          return step
        })
      )

      if (progress.error) {
        setError(progress.error)
      }

      // Check if all complete (ffmpeg is the last required dependency)
      if (progress.step === 'ffmpeg' && progress.status === 'complete') {
        // Clear any existing timeout before setting a new one
        if (completionTimeoutRef.current) {
          clearTimeout(completionTimeoutRef.current)
        }
        completionTimeoutRef.current = setTimeout(onComplete, 500)
      }
    })

    return () => {
      unsubscribe()
      // Clean up timeout on unmount
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current)
      }
    }
  }, [onComplete])

  const startSetup = async () => {
    try {
      await window.api.downloadDependencies()
    } catch (err: any) {
      setError(err.message || 'Setup failed')
    }
  }

  const handleRetry = () => {
    setError(null)
    setSteps((prev) => prev.map((step) => ({ ...step, status: 'pending' })))
    setPercent(0)
    startSetup()
  }

  const getOverallProgress = () => {
    const completed = steps.filter((s) => s.status === 'complete').length
    const stepProgress = (completed / steps.length) * 100
    const currentProgress = currentStep ? (percent / steps.length) : 0
    return Math.min(stepProgress + currentProgress, 100)
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col">
      {/* Title bar drag region */}
      <div className="drag-region h-8 bg-neutral-900" />

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md w-full">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">TubeRun</h1>
            <p className="text-neutral-400">Setting up for first use...</p>
          </div>

          {/* Progress */}
          <div className="space-y-6">
            {/* Overall progress bar */}
            <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all duration-300"
                style={{ width: `${getOverallProgress()}%` }}
              />
            </div>

            {/* Steps */}
            <div className="space-y-3">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className="flex items-center gap-3 p-3 bg-neutral-800/50 rounded-lg"
                >
                  {/* Status icon */}
                  <div className="w-6 h-6 flex items-center justify-center">
                    {step.status === 'pending' && (
                      <div className="w-2 h-2 bg-neutral-600 rounded-full" />
                    )}
                    {step.status === 'downloading' && (
                      <svg className="w-5 h-5 text-primary-400 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    )}
                    {step.status === 'complete' && (
                      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {step.status === 'error' && (
                      <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                  </div>

                  {/* Label */}
                  <span className={`flex-1 ${
                    step.status === 'downloading' ? 'text-white' :
                    step.status === 'complete' ? 'text-green-400' :
                    step.status === 'error' ? 'text-red-400' :
                    'text-neutral-500'
                  }`}>
                    {step.label}
                  </span>

                  {/* Current progress */}
                  {step.status === 'downloading' && (
                    <span className="text-sm text-neutral-400">{percent}%</span>
                  )}
                </div>
              ))}
            </div>

            {/* Error state */}
            {error && (
              <div className="space-y-4">
                <div className="p-4 bg-red-900/20 border border-red-800 rounded-lg">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
                <button
                  onClick={handleRetry}
                  className="w-full py-3 bg-primary-600 hover:bg-primary-500 rounded-lg font-medium transition-colors"
                >
                  Retry Setup
                </button>
              </div>
            )}
          </div>

          {/* Info */}
          <p className="text-center text-xs text-neutral-500 mt-8">
            Downloading required components (~200MB)
          </p>
        </div>
      </div>
    </div>
  )
}

export default SetupProgress
