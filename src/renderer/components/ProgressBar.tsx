interface ProgressBarProps {
  percent: number
  status: 'queued' | 'downloading' | 'converting' | 'retrying'
  title: string
  speed?: string
  eta?: string
  queuePosition?: number
  retryInfo?: { current: number; max: number }
  onCancel: () => void
}

function ProgressBar({
  percent,
  status,
  title,
  speed,
  eta,
  queuePosition,
  retryInfo,
  onCancel
}: ProgressBarProps) {
  const getStatusText = () => {
    switch (status) {
      case 'queued':
        return queuePosition ? `Queued (#${queuePosition})` : 'Queued'
      case 'downloading':
        return 'Downloading...'
      case 'converting':
        return 'Converting...'
      case 'retrying':
        return retryInfo
          ? `Retrying (${retryInfo.current}/${retryInfo.max})...`
          : 'Retrying...'
      default:
        return 'Processing...'
    }
  }

  const getProgressBarColor = () => {
    switch (status) {
      case 'queued':
        return 'bg-neutral-500'
      case 'downloading':
        return 'bg-primary-500'
      case 'converting':
        return 'bg-green-500'
      case 'retrying':
        return 'bg-yellow-500'
      default:
        return 'bg-primary-500'
    }
  }

  return (
    <div className="space-y-3">
      {/* Title */}
      <div className="text-center">
        <p className="text-sm text-neutral-400">{getStatusText()}</p>
        {title && (
          <p className="text-white font-medium truncate mt-1">{title}</p>
        )}
      </div>

      {/* Progress bar */}
      <div className="relative h-3 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className={`
            absolute inset-y-0 left-0 rounded-full
            transition-all duration-300 ease-out
            ${getProgressBarColor()}
            ${status !== 'queued' && percent < 100 && 'progress-active'}
          `}
          style={{ width: `${status === 'queued' ? 0 : percent}%` }}
        />
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-neutral-400">
          {status === 'queued' ? 'Waiting...' : `${Math.round(percent)}%`}
        </span>

        {/* Speed and ETA - only show when downloading */}
        {status === 'downloading' && (speed || eta) && (
          <div className="flex gap-3 text-neutral-400">
            {speed && <span>{speed}</span>}
            {eta && <span>ETA: {eta}</span>}
          </div>
        )}

        <button
          onClick={onCancel}
          className="text-neutral-500 hover:text-red-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default ProgressBar
