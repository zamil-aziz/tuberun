interface SpeedSelectorProps {
  value: number
  onChange: (value: number) => void
}

const speeds = [1, 1.25, 1.5, 2]

function SpeedSelector({ value, onChange }: SpeedSelectorProps) {
  return (
    <div className="flex-1">
      <label className="block text-sm text-neutral-400 mb-2">Speed</label>
      <div className="flex gap-1 bg-neutral-800 rounded-lg p-1">
        {speeds.map((speed) => (
          <button
            key={speed}
            onClick={() => onChange(speed)}
            className={`
              flex-1 px-3 py-2 rounded-md text-sm font-medium
              transition-all duration-150
              ${value === speed
                ? 'bg-primary-600 text-white'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-700'
              }
            `}
          >
            {speed}x
          </button>
        ))}
      </div>
    </div>
  )
}

export default SpeedSelector
