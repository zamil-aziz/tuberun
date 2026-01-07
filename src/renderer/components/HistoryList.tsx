import { useState, useEffect } from 'react'

interface HistoryItem {
  id: string
  url: string
  title: string
  outputPath: string
  timestamp: number
}

function HistoryList() {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    try {
      const items = await window.api.getHistory()
      setHistory(items)
    } catch (error) {
      console.error('Failed to load history:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleClear = async () => {
    try {
      await window.api.clearHistory()
      setHistory([])
    } catch (error) {
      console.error('Failed to clear history:', error)
    }
  }

  const handleShowInFinder = (path: string) => {
    window.api.showItemInFolder(path)
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    // Less than 24 hours
    if (diff < 86400000) {
      return 'Today'
    }
    // Less than 48 hours
    if (diff < 172800000) {
      return 'Yesterday'
    }
    // Within a week
    if (diff < 604800000) {
      return date.toLocaleDateString('en-US', { weekday: 'long' })
    }
    // Older
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  if (isLoading) {
    return null
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-neutral-600 mb-2">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <p className="text-neutral-500 text-sm">No downloads yet</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-neutral-300">Recent Downloads</h2>
        <button
          onClick={handleClear}
          className="text-sm text-neutral-500 hover:text-red-400 transition-colors"
        >
          Clear All
        </button>
      </div>

      <div className="space-y-2">
        {history.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 p-3 bg-neutral-800/50 rounded-lg hover:bg-neutral-800 transition-colors group"
          >
            {/* Music icon */}
            <div className="w-10 h-10 rounded-lg bg-neutral-700 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-primary-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{item.title}</p>
              <p className="text-xs text-neutral-500">{formatDate(item.timestamp)}</p>
            </div>

            {/* Actions */}
            <button
              onClick={() => handleShowInFinder(item.outputPath)}
              className="opacity-0 group-hover:opacity-100 p-2 text-neutral-400 hover:text-white transition-all"
              title="Show in Finder"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default HistoryList
