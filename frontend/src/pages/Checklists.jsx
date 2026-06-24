import { useEffect, useMemo, useRef, useState } from 'react'
import Banner from '../components/Banner'
import CopyLink from '../components/CopyLink'
import ProgressBar from '../components/ProgressBar'
import SectionCard from '../components/SectionCard'
import NotesAndIssues from '../components/NotesAndIssues'
import {
  CONFIG,
  DINNER_MENU,
  SHIFTS,
} from '../config'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../auth/AuthProvider'
import { useProperty } from '../hooks/useProperty'

// Dinner orders is a Casco Bay-only program; it is not a per-property toggle.
const DINNER_PROPERTIES = new Set(['casco_bay'])

const MGMT = new Set(['owner', 'manager'])

export default function Checklists() {
  const { user } = useAuth()
  const { propertyId, property } = useProperty()
  const isMgmt = MGMT.has(user?.role)
  const dinnerOn = DINNER_PROPERTIES.has(propertyId)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [openShift, setOpenShift] = useState(null)

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="page-title">Front Desk</h1>
          <p className="page-subtitle">{property?.name} · current shift checklist{dinnerOn ? ', dinner orders' : ''} and notes. Resets at midnight.</p>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input max-w-[180px]" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:items-stretch">
        <div className="lg:col-span-2 min-w-0 min-h-0">
          <ShiftPager propertyId={propertyId} date={date} onOpenShift={setOpenShift} />
        </div>
        <div className="flex flex-col gap-5 min-w-0 min-h-0">
          {dinnerOn && (
            <div className="min-w-0 lg:flex min-h-0">
              <DinnerOrders propertyId={propertyId} date={date} />
            </div>
          )}
          <div className="min-w-0 lg:flex-1 min-h-0 lg:flex">
            <NotesAndIssues propertyId={propertyId} />
          </div>
        </div>
      </div>

      {openShift && (
        <ShiftSheet
          propertyId={propertyId}
          date={date}
          shift={openShift}
          isMgmt={isMgmt}
          onClose={() => setOpenShift(null)}
        />
      )}
    </div>
  )
}

// Which shift is "live" given the local clock: 1st 7a–3p, 2nd 3p–11p,
// 3rd 11p–7a. Used as the pager's default so front desk lands on the
// checklist that's actually in play.
function shiftIndexForNow() {
  const h = new Date().getHours()
  if (h >= 7 && h < 15) return 0
  if (h >= 15 && h < 23) return 1
  return 2
}

function ShiftPager({ propertyId, date, onOpenShift }) {
  const api = useApi()
  const [data, setData] = useState({}) // { '1st': { tasks, handoff } }
  const [error, setError] = useState('')
  const [idx, setIdx] = useState(shiftIndexForNow)
  const touchX = useRef(null)

  async function load() {
    try {
      setError('')
      const entries = await Promise.all(SHIFTS.map(async (s) => {
        const [t, h] = await Promise.all([
          api.get(`/api/shifts/${propertyId}/tasks`, { shift: s.id, date }).catch(() => ({ tasks: [] })),
          api.get(`/api/shifts/${propertyId}/handoff`, { shift: s.id, date }).catch(() => ({ notes: '' })),
        ])
        return [s.id, { tasks: t.tasks || [], handoff: h || { notes: '' } }]
      }))
      setData(Object.fromEntries(entries))
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyId, date])

  async function toggleTask(shiftId, task) {
    const next = !task.completed
    setData((prev) => ({
      ...prev,
      [shiftId]: {
        ...prev[shiftId],
        tasks: (prev[shiftId]?.tasks || []).map((t) => t.task_id === task.task_id ? { ...t, completed: next } : t),
      },
    }))
    try {
      await api.post(`/api/shifts/${propertyId}/tasks/${task.task_id}/complete`, { shift: shiftId, date, completed: next })
    } catch (e) {
      setError(e.message)
      load()
    }
  }

  const go = (delta) => setIdx((i) => Math.min(SHIFTS.length - 1, Math.max(0, i + delta)))
  function onTouchStart(e) { touchX.current = e.touches[0].clientX }
  function onTouchEnd(e) {
    if (touchX.current == null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
    touchX.current = null
  }

  const s = SHIFTS[idx]
  const d = data[s.id] || { tasks: [], handoff: { notes: '' } }
  const completed = d.tasks.filter((t) => t.completed).length
  const pct = d.tasks.length ? Math.round((completed / d.tasks.length) * 100) : 0
  const allDone = d.tasks.length > 0 && completed === d.tasks.length
  const status = pct === 0 ? 'Not started' : allDone ? 'Closed' : `${pct}%`
  const nowIdx = shiftIndexForNow()

  const grouped = useMemo(() => {
    const m = new Map()
    for (const t of d.tasks) {
      const cat = t.category || 'General'
      if (!m.has(cat)) m.set(cat, [])
      m.get(cat).push(t)
    }
    return Array.from(m.entries())
  }, [d.tasks])

  return (
    <div className="card h-full flex flex-col lg:min-h-[480px]" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {error && <Banner tone="error">{error}</Banner>}

      {/* Pager header: arrows + active shift + live badge */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => go(-1)} disabled={idx === 0}
          className="w-9 h-9 grid place-items-center rounded-full text-ink-muted hover:bg-surface-muted disabled:opacity-30 disabled:hover:bg-transparent text-xl shrink-0"
          aria-label="Previous shift"
        >‹</button>
        <div className="text-center min-w-0">
          <div className="flex items-center justify-center gap-2">
            <h2 className="section-title">{s.label} shift</h2>
            {idx === nowIdx && <span className="pill bg-brand-tint text-brand">Now</span>}
          </div>
          <div className="text-[12px] text-ink-muted">{s.range} · {status}</div>
        </div>
        <button
          onClick={() => go(1)} disabled={idx === SHIFTS.length - 1}
          className="w-9 h-9 grid place-items-center rounded-full text-ink-muted hover:bg-surface-muted disabled:opacity-30 disabled:hover:bg-transparent text-xl shrink-0"
          aria-label="Next shift"
        >›</button>
      </div>

      <ProgressBar value={completed} max={Math.max(1, d.tasks.length)} tone={allDone ? 'positive' : 'brand'} className="mt-2.5 mb-2" />

      {/* Segmented quick-jump between shifts */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {SHIFTS.map((sh, i) => (
          <button
            key={sh.id} onClick={() => setIdx(i)}
            className={`text-[12px] font-medium rounded-lg py-1.5 border transition-colors ${
              i === idx ? 'bg-brand-tint border-brand text-brand' : 'bg-white border-line-subtle text-ink-muted hover:text-ink'
            }`}
          >
            {sh.label}{i === nowIdx ? ' ·' : ''}
          </button>
        ))}
      </div>

      <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto -mx-1 px-1 space-y-4">
        {allDone && d.handoff?.notes && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-ink-muted font-semibold mb-1">Handoff notes</div>
            <div className="text-[13px] bg-surface-muted rounded-lg p-2.5 leading-snug text-ink-body">{d.handoff.notes}</div>
          </div>
        )}
        {d.tasks.length === 0 ? (
          <div className="text-[13px] text-ink-muted py-8 text-center">No tasks defined for this shift.</div>
        ) : (
          grouped.map(([category, list]) => (
            <div key={category}>
              {category !== 'General' && (
                <div className="text-[11px] uppercase tracking-[0.06em] text-ink-muted font-semibold mb-1.5">{category}</div>
              )}
              <ul className="divide-y divide-line-subtle border border-line-subtle rounded-lg">
                {list.map((t) => (
                  <li key={t.task_id} className="px-3 py-2.5 flex items-center gap-3">
                    <Check checked={t.completed} onChange={() => toggleTask(s.id, t)} />
                    <span className={`flex-1 text-[14px] ${t.completed ? 'line-through text-ink-muted' : 'text-ink'}`}>{t.task_text}</span>
                    {t.completed_by && <span className="text-[11px] text-ink-muted">{t.completed_by}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <button
        onClick={() => onOpenShift({ id: s.id, label: s.label, range: s.range, total: d.tasks.length, onChange: load })}
        className="mt-3 text-[12px] text-brand font-medium hover:underline self-start"
      >
        Open all {d.tasks.length} tasks &amp; handoff →
      </button>
    </div>
  )
}

function ShiftSheet({ propertyId, date, shift, isMgmt, onClose }) {
  const api = useApi()
  const [tasks, setTasks] = useState([])
  const [handoff, setHandoff] = useState({ notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  async function load() {
    try {
      setError('')
      const [tres, hres] = await Promise.all([
        api.get(`/api/shifts/${propertyId}/tasks`, { shift: shift.id, date }),
        api.get(`/api/shifts/${propertyId}/handoff`, { shift: shift.id, date }),
      ])
      setTasks(tres.tasks || [])
      setHandoff(hres || { notes: '' })
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [shift.id, date])

  async function toggle(task) {
    const next = !task.completed
    setTasks((ts) => ts.map((t) => t.task_id === task.task_id ? { ...t, completed: next } : t))
    try {
      await api.post(`/api/shifts/${propertyId}/tasks/${task.task_id}/complete`, { shift: shift.id, date, completed: next })
      shift.onChange?.()
    } catch (e) {
      setError(e.message)
      setTasks((ts) => ts.map((t) => t.task_id === task.task_id ? { ...t, completed: !next } : t))
    }
  }

  async function saveHandoff() {
    setSaving(true); setError('')
    try {
      await api.post(`/api/shifts/${propertyId}/handoff`, { shift: shift.id, date, notes: handoff.notes })
      shift.onChange?.()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const grouped = useMemo(() => {
    const m = new Map()
    for (const t of tasks) {
      const cat = t.category || 'General'
      if (!m.has(cat)) m.set(cat, [])
      m.get(cat).push(t)
    }
    return Array.from(m.entries())
  }, [tasks])

  const done = tasks.filter((t) => t.completed).length
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center sm:justify-end" onClick={onClose}>
      <div className="bg-white sm:rounded-l-2xl rounded-t-2xl w-full sm:max-w-lg max-h-[92vh] sm:h-full sm:max-h-none overflow-y-auto shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-line-subtle px-6 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <div className="text-[20px] font-semibold text-ink">{shift.label} shift</div>
            <div className="text-[12px] text-ink-muted">{shift.range} · {done} of {tasks.length} done · {pct}%</div>
          </div>
          <div className="flex items-center gap-2">
            {isMgmt && (
              <button onClick={() => setEditing((m) => !m)} className="btn-secondary text-[12px] min-h-0 px-2 py-1">
                {editing ? 'Done' : 'Edit'}
              </button>
            )}
            <button onClick={onClose} className="text-ink-muted text-2xl w-8 h-8 grid place-items-center rounded-full hover:bg-surface-muted">×</button>
          </div>
        </div>
        <div className="p-6 space-y-5">
          {error && <Banner tone="error">{error}</Banner>}
          {editing && isMgmt && <TaskTemplateEditor propertyId={propertyId} shiftId={shift.id} onChange={load} />}
          {grouped.length === 0 ? (
            <div className="text-[14px] text-ink-muted py-8 text-center">No tasks defined.</div>
          ) : (
            grouped.map(([category, list]) => (
              <div key={category}>
                <div className="text-[12px] uppercase tracking-[0.06em] text-ink-muted font-semibold mb-2">{category}</div>
                <ul className="divide-y divide-line-subtle border border-line-subtle rounded-lg">
                  {list.map((t) => (
                    <li key={t.task_id} className="px-3 py-2.5 flex items-center gap-3">
                      <Check checked={t.completed} onChange={() => toggle(t)} />
                      <span className={`flex-1 text-[14px] ${t.completed ? 'line-through text-ink-muted' : 'text-ink'}`}>{t.task_text}</span>
                      {t.completed_by && <span className="text-[11px] text-ink-muted">{t.completed_by}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] uppercase tracking-[0.06em] text-ink-muted font-semibold">Handoff notes</h3>
              {handoff.updated_at && <span className="text-[11px] text-ink-muted">Updated {new Date(handoff.updated_at).toLocaleString()}</span>}
            </div>
            <textarea className="textarea min-h-[100px]" value={handoff.notes || ''} onChange={(e) => setHandoff({ ...handoff, notes: e.target.value })} placeholder="Notes for the next shift…" />
            <div className="flex justify-end mt-2">
              <button onClick={saveHandoff} disabled={saving} className="btn-primary text-[13px] min-h-0 py-2">{saving ? 'Saving…' : 'Save notes'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Check({ checked, onChange }) {
  return (
    <button onClick={onChange} className={`w-[20px] h-[20px] rounded-md border flex-shrink-0 grid place-items-center ${checked ? 'bg-brand border-brand' : 'bg-white border-line hover:border-brand'}`}>
      {checked && (
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.2L5.5 10.2L11.5 4.2" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
    </button>
  )
}

function TaskTemplateEditor({ propertyId, shiftId, onChange }) {
  const api = useApi()
  const [taskText, setTaskText] = useState('')
  const [category, setCategory] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [busy, setBusy] = useState(false)
  async function add() {
    if (!taskText.trim()) return
    setBusy(true)
    try {
      await api.post(`/api/shifts/${propertyId}/templates`, { shift: shiftId, task_text: taskText, category, sort_order: Number(sortOrder) })
      setTaskText('')
      onChange?.()
    } finally { setBusy(false) }
  }
  return (
    <div className="border border-line-subtle bg-surface-subtle rounded-lg p-3 space-y-2">
      <div className="text-[12px] font-medium text-ink-body">Add a task to {shiftId} shift</div>
      <input className="input" placeholder="Task description" value={taskText} onChange={(e) => setTaskText(e.target.value)} />
      <div className="grid grid-cols-[1fr,90px,auto] gap-2">
        <input className="input" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className="input" placeholder="Order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        <button className="btn-primary" disabled={busy} onClick={add}>{busy ? '…' : 'Add'}</button>
      </div>
    </div>
  )
}

function DinnerOrders({ propertyId, date }) {
  const api = useApi()
  const enabled = DINNER_PROPERTIES.has(propertyId)
  const [orders, setOrders] = useState([])
  const [error, setError] = useState('')

  async function load() {
    if (!enabled) return
    try {
      setError('')
      const res = await api.get(`/api/dinner-orders/${propertyId}`, { date })
      setOrders(res.orders || [])
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyId, date, enabled])

  async function setStatus(o, status) {
    try {
      await api.put(`/api/dinner-orders/${propertyId}/${o.order_id}`, { date, status })
      setOrders((arr) => arr.map((x) => x.order_id === o.order_id ? { ...x, status } : x))
    } catch (e) { setError(e.message) }
  }

  const formUrl = enabled && CONFIG.publicFormsBaseUrl ? `${CONFIG.publicFormsBaseUrl}/dinner.html?p=${propertyId}` : ''
  const open = orders.filter((o) => o.status === 'open').length

  if (!enabled) return null

  return (
    <SectionCard
      title="Dinner orders · tonight"
      subtitle="Prep by 3:00 pm"
      actions={<span className="pill bg-brand-tint text-brand">{open} open / {orders.length}</span>}
      className="w-full min-w-0 lg:max-h-[360px] flex flex-col min-h-0"
    >
      {error && <Banner tone="error">{error}</Banner>}
      {formUrl && <div className="mb-3"><CopyLink url={formUrl} label="Guest order form" /></div>}
      {orders.length === 0 ? (
        <div className="text-[14px] text-ink-muted py-10 text-center">No orders today.</div>
      ) : (
        <div className="overflow-x-auto lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          <table className="table-clean text-[13px]">
            <thead>
              <tr>
                <th className="w-20">Time</th>
                <th className="w-16">Room</th>
                <th>Guest</th>
                <th>Sandwich</th>
                <th>Side</th>
                <th>Drink</th>
                <th>Notes</th>
                <th className="w-24 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const sandwich = DINNER_MENU.sandwiches.find((s) => s.id === o.sandwich)
                const sides = DINNER_MENU.sides.filter((s) => o.items?.[s.id])
                const drink = DINNER_MENU.drinks.find((d) => d.id === o.drink)
                const done = o.status === 'completed'
                return (
                  <tr key={o.order_id} className={done ? 'opacity-60' : ''}>
                    <td className="tabular-nums text-ink-body">
                      {o.submitted_at ? new Date(o.submitted_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="tabular-nums text-ink">{o.room_number || '—'}</td>
                    <td className="text-ink">{o.guest_name}</td>
                    <td>{sandwich && sandwich.id !== 'none' ? sandwich.label : <span className="text-ink-muted">—</span>}</td>
                    <td>{sides.length > 0 ? sides.map((s) => s.label).join(', ') : <span className="text-ink-muted">—</span>}</td>
                    <td>{drink && drink.id !== 'none' ? drink.label : <span className="text-ink-muted">—</span>}</td>
                    <td className="text-[12px] text-ink-muted">{o.notes || '—'}</td>
                    <td className="text-right">
                      {done ? (
                        <button onClick={() => setStatus(o, 'open')} className="btn-ghost text-[11px] min-h-0 px-2 py-1">Reopen</button>
                      ) : (
                        <button onClick={() => setStatus(o, 'completed')} className="text-[11px] text-brand font-semibold">Mark made</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}


