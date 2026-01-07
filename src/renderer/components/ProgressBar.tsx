interface ProgressBarProps {
  percent: number
  status: 'downloading' | 'converting'
  title: string
  onCancel: () => void
}

function ProgressBar({ percent, status, title, onCancel }: ProgressBarProps) {
  const statusText = status === 'downloading' ? 'Downloading...' : 'Converting...'

  return (
    <div className="space-y-3">
      {/* Title */}
      <div className="text-center">
        <p className="text-sm text-neutral-400">{statusText}</p>
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
            ${status === 'downloading' ? 'bg-primary-500' : 'bg-green-500'}
            ${percent < 100 && 'progress-active'}
          `}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Percent and cancel */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-neutral-400">{Math.round(percent)}%</span>
        <button
          onClick={onCancel}
          className="text-sm text-neutral-500 hover:text-red-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default ProgressBar
