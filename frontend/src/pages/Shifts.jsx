import { useEffect, useMemo, useState } from 'react'
import Banner from '../components/Banner'
import { CHECKLIST_TYPES, SHIFTS } from '../config'
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
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="page-title">Shift Checklist</h1>
          <p className="page-subtitle">Daily shift tasks, handoff notes, and standalone checklists.</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input max-w-[180px]"
        />
        {isMgmt && (
          <button onClick={() => setEditMode((m) => !m)} className="btn-secondary">
            {editMode ? 'Done editing' : 'Edit tasks'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {SHIFTS.map((s) => {
          const active = shift === s.id
          return (
            <button
              key={s.id}
              onClick={() => setShift(s.id)}
              className={`px-3 py-3.5 rounded-lg border transition-all text-left ${
                active
                  ? 'bg-white border-brand ring-1 ring-brand text-ink shadow-card'
                  : 'bg-white border-line-subtle text-ink-body hover:border-line hover:shadow-card'
              }`}
            >
              <div className="text-[16px] font-semibold leading-none">{s.label} shift</div>
              <div className="text-[12px] text-ink-muted mt-1.5">{s.range}</div>
            </button>
          )
        })}
      </div>

      <div className="card">
        <div className="flex items-center gap-4">
          <div className="text-[14px] text-ink-body tabular-nums">
            <span className="font-medium text-ink">{completedCount}</span> of {tasks.length} complete
          </div>
          <div className="flex-1 h-1.5 bg-surface-sunken rounded-full overflow-hidden">
            <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-[14px] text-ink font-medium tabular-nums w-10 text-right">{pct}%</div>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {editMode && isMgmt && (
        <TaskTemplateEditor propertyId={propertyId} shift={shift} onChange={loadAll} />
      )}

      {grouped.length === 0 ? (
        <div className="card text-center text-ink-muted py-12 text-[14px]">No tasks defined for this shift.</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([category, list]) => (
            <div key={category} className="card">
              <h3 className="section-title mb-4">{category}</h3>
              <ul className="divide-y divide-line-subtle -mx-2">
                {list.map((t) => (
                  <li key={t.task_id} className="py-3 px-2 flex items-center gap-3">
                    <Check checked={t.completed} onChange={() => toggleTask(t)} />
                    <div className={`flex-1 text-[15px] ${t.completed ? 'line-through text-ink-muted' : 'text-ink'}`}>
                      {t.task_text}
                    </div>
                    {t.completed_by && (
                      <div className="text-[12px] text-ink-muted hidden sm:block">{t.completed_by}</div>
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
          <h3 className="section-title">Handoff notes</h3>
          {handoff.updated_at && (
            <div className="text-[12px] text-ink-muted">Updated {new Date(handoff.updated_at).toLocaleString()}</div>
          )}
        </div>
        <textarea
          className="textarea min-h-[120px]"
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

      <StandaloneChecklists propertyId={propertyId} date={date} isMgmt={isMgmt} />
    </div>
  )
}

function Check({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      className={`w-[22px] h-[22px] rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${
        checked
          ? 'bg-brand border-brand'
          : 'bg-white border-line hover:border-brand'
      }`}
      aria-label={checked ? 'Mark incomplete' : 'Mark complete'}
    >
      {checked && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2.5 7.2L5.5 10.2L11.5 4.2" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
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
    <div className="card bg-surface-subtle">
      <h3 className="section-title mb-3">Add a task to {shift} shift</h3>
      <div className="grid sm:grid-cols-[1fr,180px,90px,auto] gap-2">
        <input className="input" placeholder="Task description" value={taskText} onChange={(e) => setTaskText(e.target.value)} />
        <input className="input" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className="input" placeholder="Order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        <button className="btn-primary" disabled={busy} onClick={add}>{busy ? 'Saving…' : 'Add'}</button>
      </div>
    </div>
  )
}

function StandaloneChecklists({ propertyId, date, isMgmt }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-title">Standalone checklists</h2>
        <p className="text-[13px] text-ink-muted mt-0.5">Breakfast cleanup and groundsman lists for this date.</p>
      </div>
      {CHECKLIST_TYPES.map((t) => (
        <ChecklistCard key={t.id} propertyId={propertyId} type={t} date={date} />
      ))}
    </div>
  )
}

function ChecklistCard({ propertyId, type, date }) {
  const api = useApi()
  const [items, setItems] = useState([])
  const [error, setError] = useState('')

  async function load() {
    try {
      setError('')
      const res = await api.get(`/api/checklists/${propertyId}`, { type: type.id, date })
      setItems(res.items || [])
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => { load() }, [propertyId, type.id, date])

  async function toggle(item) {
    const next = !item.completed
    setItems((arr) => arr.map((i) => i.item_index === item.item_index ? { ...i, completed: next } : i))
    try {
      await api.post(`/api/checklists/${propertyId}/items/${item.item_index}/complete`, {
        type: type.id, date, completed: next,
      })
    } catch (e) {
      setError(e.message)
      setItems((arr) => arr.map((i) => i.item_index === item.item_index ? { ...i, completed: !next } : i))
    }
  }

  const done = items.filter((i) => i.completed).length
  const pct = items.length ? Math.round((done / items.length) * 100) : 0

  return (
    <div className="card">
      <div className="flex items-center gap-4 mb-4">
        <h3 className="section-title flex-1">{type.label}</h3>
        <div className="text-[13px] text-ink-body tabular-nums">{done} / {items.length}</div>
        <div className="w-32 h-1.5 bg-surface-sunken rounded-full overflow-hidden">
          <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {items.length === 0 ? (
        <div className="text-[14px] text-ink-muted py-4 text-center">No items defined.</div>
      ) : (
        <ul className="divide-y divide-line-subtle -mx-2">
          {items.map((item) => (
            <li key={item.item_index} className="py-3 px-2 flex items-start gap-3">
              <div className="mt-0.5">
                <Check checked={item.completed} onChange={() => toggle(item)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-[15px] ${item.completed ? 'line-through text-ink-muted' : 'text-ink'}`}>
                  {item.task_text}
                </div>
                {item.staff_initials && (
                  <div className="text-[12px] text-ink-muted mt-1">
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
