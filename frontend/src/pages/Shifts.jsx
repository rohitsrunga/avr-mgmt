import { useEffect, useMemo, useState } from 'react'
import Banner from '../components/Banner'
import { SHIFTS } from '../config'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../auth/AuthProvider'
import { useProperty } from '../hooks/useProperty'

const MGMT = ['owner', 'manager']

export default function Shifts() {
  const api = useApi()
  const { user } = useAuth()
  const { propertyId } = useProperty()
  const [shift, setShift] = useState('1st')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [tasks, setTasks] = useState([])
  const [handoff, setHandoff] = useState({ notes: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const isMgmt = MGMT.includes(user?.role)

  async function loadAll() {
    try {
      setError('')
      const [tres, hres] = await Promise.all([
        api.get(`/api/shifts/${propertyId}/tasks`, { shift, date }),
        api.get(`/api/shifts/${propertyId}/handoff`, { shift, date }),
      ])
      setTasks(tres.tasks || [])
      setHandoff(hres || { notes: '' })
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { loadAll() }, [propertyId, shift, date])

  async function toggleTask(task) {
    const next = !task.completed
    setTasks((ts) => ts.map((t) => t.task_id === task.task_id ? { ...t, completed: next } : t))
    try {
      await api.post(`/api/shifts/${propertyId}/tasks/${task.task_id}/complete`, {
        shift, date, completed: next,
      })
      loadAll()
    } catch (e) {
      setError(e.message)
      setTasks((ts) => ts.map((t) => t.task_id === task.task_id ? { ...t, completed: !next } : t))
    }
  }

  async function saveHandoff() {
    setSaving(true)
    try {
      await api.post(`/api/shifts/${propertyId}/handoff`, { shift, date, notes: handoff.notes })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const grouped = useMemo(() => {
    const map = new Map()
    for (const t of tasks) {
      const cat = t.category || 'General'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat).push(t)
    }
    return Array.from(map.entries())
  }, [tasks])

  const completedCount = tasks.filter((t) => t.completed).length
  const pct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0

  return (
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold flex-1">Shifts</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input max-w-xs"
        />
        {isMgmt && (
          <button onClick={() => setEditMode((m) => !m)} className="btn-secondary text-sm">
            {editMode ? 'Done editing' : 'Edit tasks'}
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {SHIFTS.map((s) => {
          const active = shift === s.id
          const accentBg = s.accent === 'amber' ? 'bg-accent-amber' : s.accent === 'green' ? 'bg-accent-teal' : 'bg-accent-blue'
          return (
            <button
              key={s.id}
              onClick={() => setShift(s.id)}
              className={`flex-1 px-3 py-3 rounded-lg border transition-colors ${active ? `${accentBg} border-transparent text-white` : 'bg-ink-800 border-ink-700 text-text-body hover:border-ink-600'}`}
            >
              <div className="font-display text-lg leading-none">{s.label} shift</div>
              <div className="text-xs mt-1 opacity-90">{s.range}</div>
            </button>
          )
        })}
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-3">
          <div className="text-sm font-mono">{completedCount} of {tasks.length} complete</div>
          <div className="flex-1 h-2 bg-ink-700 rounded overflow-hidden">
            <div className="h-full bg-accent-teal transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-sm font-mono tabular-nums">{pct}%</div>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {editMode && isMgmt && (
        <TaskTemplateEditor propertyId={propertyId} shift={shift} onChange={loadAll} />
      )}

      {grouped.length === 0 ? (
        <div className="card text-center text-text-muted py-10">No tasks defined for this shift.</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([category, list]) => (
            <div key={category} className="card">
              <h3 className="font-display text-base font-semibold mb-3">{category}</h3>
              <ul className="divide-y divide-ink-700">
                {list.map((t) => (
                  <li key={t.task_id} className="py-2.5 flex items-center gap-3">
                    <button
                      onClick={() => toggleTask(t)}
                      className={`w-6 h-6 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                        t.completed ? 'bg-accent-teal border-accent-teal' : 'border-ink-600 hover:border-accent-teal'
                      }`}
                      aria-label={t.completed ? 'Mark incomplete' : 'Mark complete'}
                    >
                      {t.completed && <span className="text-white text-sm">✓</span>}
                    </button>
                    <div className={`flex-1 ${t.completed ? 'line-through text-text-muted' : ''}`}>
                      {t.task_text}
                    </div>
                    {t.completed_by && (
                      <div className="tag hidden sm:block">{t.completed_by}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-base font-semibold">Handoff notes</h3>
          {handoff.updated_at && (
            <div className="tag">Updated {new Date(handoff.updated_at).toLocaleString()}</div>
          )}
        </div>
        <textarea
          className="input min-h-[120px]"
          placeholder="Notes for the next shift…"
          value={handoff.notes || ''}
          onChange={(e) => setHandoff({ ...handoff, notes: e.target.value })}
        />
        <div className="mt-3 flex justify-end">
          <button onClick={saveHandoff} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskTemplateEditor({ propertyId, shift, onChange }) {
  const api = useApi()
  const [taskText, setTaskText] = useState('')
  const [category, setCategory] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!taskText.trim()) return
    setBusy(true)
    try {
      await api.post(`/api/shifts/${propertyId}/templates`, {
        shift, task_text: taskText, category, sort_order: Number(sortOrder),
      })
      setTaskText('')
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card border-accent-amber/40">
      <h3 className="font-display text-base font-semibold mb-3">Add a task to {shift} shift</h3>
      <div className="grid sm:grid-cols-[1fr,180px,90px,auto] gap-2">
        <input className="input" placeholder="Task description" value={taskText} onChange={(e) => setTaskText(e.target.value)} />
        <input className="input" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className="input" placeholder="Order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        <button className="btn-primary" disabled={busy} onClick={add}>{busy ? 'Saving…' : 'Add'}</button>
      </div>
    </div>
  )
}
