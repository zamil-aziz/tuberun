import Store from 'electron-store'

interface HistoryItem {
  id: string
  url: string
  title: string
  outputPath: string
  timestamp: number
}

interface StoreSchema {
  history: HistoryItem[]
}

const store = new Store<StoreSchema>({
  name: 'tuberun-history',
  defaults: {
    history: [],
  },
})

const MAX_HISTORY_ITEMS = 50

export function getHistory(): HistoryItem[] {
  return store.get('history', [])
}

export function addToHistory(item: Omit<HistoryItem, 'timestamp'>): void {
  const history = getHistory()

  // Add new item at the beginning
  const newItem: HistoryItem = {
    ...item,
    timestamp: Date.now(),
  }

  // Remove duplicate if exists
  const filtered = history.filter((h) => h.outputPath !== item.outputPath)

  // Add to beginning and limit size
  const updated = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS)

  store.set('history', updated)
}

export function clearHistory(): void {
  store.set('history', [])
}

export function removeFromHistory(id: string): void {
  const history = getHistory()
  const filtered = history.filter((h) => h.id !== id)
  store.set('history', filtered)
}
