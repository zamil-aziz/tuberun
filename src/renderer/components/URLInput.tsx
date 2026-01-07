import { useEffect, useRef } from 'react'

interface URLInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

function URLInput({ value, onChange, disabled }: URLInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus and handle paste
  useEffect(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus()
    }
  }, [disabled])

  // Handle keyboard shortcut Cmd+V
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !disabled) {
        // Let the paste happen naturally into the input
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled])

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    // Check if it's a YouTube URL
    if (isYouTubeURL(text)) {
      e.preventDefault()
      onChange(text.trim())
    }
  }

  const isYouTubeURL = (url: string): boolean => {
    const patterns = [
      /youtube\.com\/watch\?v=/,
      /youtu\.be\//,
      /youtube\.com\/shorts\//,
      /youtube\.com\/embed\//,
      /music\.youtube\.com\/watch\?v=/,
    ]
    return patterns.some((pattern) => pattern.test(url))
  }

  const isValidURL = value.trim() === '' || isYouTubeURL(value)

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        disabled={disabled}
        placeholder="Paste YouTube URL here..."
        className={`
          w-full px-4 py-3
          bg-neutral-800
          border-2 rounded-xl
          text-white placeholder-neutral-500
          transition-all duration-200
          disabled:opacity-50 disabled:cursor-not-allowed
          ${isValidURL
            ? 'border-neutral-700 focus:border-primary-500'
            : 'border-red-500'
          }
          ${!disabled && 'hover:border-neutral-600'}
        `}
        spellCheck={false}
        autoComplete="off"
      />

      {/* URL validation indicator */}
      {value && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {isYouTubeURL(value) ? (
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )}
        </div>
      )}

      {/* Helper text */}
      {value && !isYouTubeURL(value) && (
        <p className="mt-2 text-sm text-red-400">
          Please enter a valid YouTube URL
        </p>
      )}
    </div>
  )
}

export default URLInput
