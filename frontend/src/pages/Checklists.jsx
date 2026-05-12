import { useEffect, useState } from 'react'
import Banner from '../components/Banner'
import { CHECKLIST_TYPES } from '../config'
import { useApi } from '../hooks/useApi'
import { useProperty } from '../hooks/useProperty'

export default function Checklists() {
  const api = useApi()
  const { propertyId } = useProperty()
  const [type, setType] = useState(CHECKLIST_TYPES[0].id)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState([])
  const [error, setError] = useState('')

  async function load() {
    try {
      setError('')
      const res = await api.get(`/api/checklists/${propertyId}`, { type, date })
      setItems(res.items || [])
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [propertyId, type, date])

  async function toggle(item) {
    const next = !item.completed
    setItems((arr) => arr.map((i) => i.item_index === item.item_index ? { ...i, completed: next } : i))
    try {
      await api.post(`/api/checklists/${propertyId}/items/${item.item_index}/complete`, {
        type, date, completed: next,
      })
      load()
    } catch (e) {
      setError(e.message)
      setItems((arr) => arr.map((i) => i.item_index === item.item_index ? { ...i, completed: !next } : i))
    }
  }

  const done = items.filter((i) => i.completed).length
  const pct = items.length ? Math.round((done / items.length) * 100) : 0

  return (
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold flex-1">Checklists</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input max-w-xs" />
      </div>

      <div className="flex gap-2 flex-wrap">
        {CHECKLIST_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={`px-3 py-2 rounded-md text-sm ${type === t.id ? 'bg-accent-teal text-white' : 'bg-ink-800 text-text-secondary hover:text-text-primary'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="flex items-center gap-3">
          <div className="text-sm font-mono">{done} of {items.length}</div>
          <div className="flex-1 h-2 bg-ink-700 rounded overflow-hidden">
            <div className="h-full bg-accent-teal transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="font-mono text-sm tabular-nums">{pct}%</div>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {items.length === 0 ? (
        <div className="card text-center text-text-muted py-10">No items in this checklist.</div>
      ) : (
        <ul className="card divide-y divide-ink-700 p-0">
          {items.map((item) => (
            <li key={item.item_index} className="p-4 flex items-start gap-3">
              <button
                onClick={() => toggle(item)}
                className={`w-6 h-6 mt-0.5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                  item.completed ? 'bg-accent-teal border-accent-teal' : 'border-ink-600 hover:border-accent-teal'
                }`}
              >
                {item.completed && <span className="text-white text-sm">✓</span>}
              </button>
              <div className="flex-1 min-w-0">
                <div className={item.completed ? 'line-through text-text-muted' : ''}>
                  {item.task_text}
                </div>
                {item.staff_initials && (
                  <div className="tag mt-1">
                    {item.staff_initials}{item.completed_at ? ` · ${new Date(item.completed_at).toLocaleTimeString()}` : ''}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
