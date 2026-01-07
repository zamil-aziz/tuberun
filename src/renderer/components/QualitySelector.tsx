interface QualitySelectorProps {
  value: '128' | '192' | '256' | '320'
  onChange: (value: '128' | '192' | '256' | '320') => void
}

const qualities: Array<{ value: '128' | '192' | '256' | '320'; label: string }> = [
  { value: '128', label: '128' },
  { value: '192', label: '192' },
  { value: '256', label: '256' },
  { value: '320', label: '320' },
]

function QualitySelector({ value, onChange }: QualitySelectorProps) {
  return (
    <div className="flex-1">
      <label className="block text-sm text-neutral-400 mb-2">Quality (kbps)</label>
      <div className="flex gap-1 bg-neutral-800 rounded-lg p-1">
        {qualities.map((q) => (
          <button
            key={q.value}
            onClick={() => onChange(q.value)}
            className={`
              flex-1 px-3 py-2 rounded-md text-sm font-medium
              transition-all duration-150
              ${value === q.value
                ? 'bg-primary-600 text-white'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-700'
              }
            `}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default QualitySelector
