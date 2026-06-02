import { useEffect, useMemo, useState } from 'react'
import Banner from '../components/Banner'
import CopyLink from '../components/CopyLink'
import ProgressBar from '../components/ProgressBar'
import SectionCard from '../components/SectionCard'
import {
  CONFIG,
  DINNER_MENU,
  SHIFTS,
} from '../config'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../auth/AuthProvider'
import { useFeatureConfig } from '../hooks/useFeatureConfig'
import { useProperty } from '../hooks/useProperty'

const MGMT = new Set(['owner', 'manager'])

export default function Checklists() {
  const { user } = useAuth()
  const { propertyId, property } = useProperty()
  const isMgmt = MGMT.has(user?.role)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [openShift, setOpenShift] = useState(null)

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="page-title">Checklists</h1>
          <p className="page-subtitle">{property?.name} · today's shift, dinner, marketing, P&amp;F and standalone lists. Resets at midnight.</p>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input max-w-[180px]" />
      </div>

      <OccupancyBANs propertyId={propertyId} />

      <ShiftRow propertyId={propertyId} date={date} onOpenShift={setOpenShift} />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <DinnerOrders propertyId={propertyId} date={date} />
        </div>
        <div className="space-y-5">
          <ParkFlyPanel propertyId={propertyId} />
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

function OccupancyBANs({ propertyId }) {
  const api = useApi()
  const [data, setData] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    api.get(`/api/reports/${propertyId}/today`)
      .then((res) => { if (!cancelled) { setData(res); setLoaded(true) } })
      .catch(() => { if (!cancelled) { setData(null); setLoaded(true) } })
    return () => { cancelled = true }
  }, [propertyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const stale = data?.synced_at && (Date.now() - new Date(data.synced_at).getTime() > 12 * 3600 * 1000)
  const noData = loaded && (!data || !data.synced_at)
  const hint = noData
    ? 'Cloudbeds not connected'
    : stale
      ? `synced ${timeAgo(data.synced_at)}`
      : data?.synced_at ? `synced ${timeAgo(data.synced_at)}` : ''

  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      <BAN label="Arrivals"   value={noData ? '—' : data?.arrivals}   hint={hint} />
      <BAN label="In house"   value={noData ? '—' : data?.in_house}   hint={hint} />
      <BAN label="Departures" value={noData ? '—' : data?.departures} hint={hint} />
    </div>
  )
}

function BAN({ label, value, hint }) {
  return (
    <div className="card">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">{label}</div>
      <div className="text-[32px] font-semibold tracking-tight tabular-nums mt-1 text-ink">{value ?? '—'}</div>
      {hint && <div className="text-[11px] text-ink-muted mt-0.5 truncate">{hint}</div>}
    </div>
  )
}

function timeAgo(iso) {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function ShiftRow({ propertyId, date, onOpenShift }) {
  const api = useApi()
  const [data, setData] = useState({}) // { '1st': { tasks, handoff } }
  const [error, setError] = useState('')

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

  return (
    <div className="space-y-3">
      {error && <Banner tone="error">{error}</Banner>}
      <div className="grid md:grid-cols-3 gap-4">
        {SHIFTS.map((s) => {
          const d = data[s.id] || { tasks: [], handoff: { notes: '' } }
          const completed = d.tasks.filter((t) => t.completed).length
          const pct = d.tasks.length ? Math.round((completed / d.tasks.length) * 100) : 0
          const allDone = d.tasks.length > 0 && completed === d.tasks.length
          const upcoming = d.tasks.filter((t) => !t.completed).slice(0, 8)
          const status = pct === 0 ? 'Not started' : allDone ? 'Closed' : `${pct}%`
          const tone = allDone ? 'positive' : pct === 0 ? 'neutral' : 'brand'
          return (
            <div key={s.id} className="card flex flex-col min-h-[460px]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[14px] font-semibold text-ink">{s.label} shift · {s.range}</h3>
                <span className={`pill ${pillTone(tone)}`}>{status}</span>
              </div>
              <ProgressBar value={completed} max={Math.max(1, d.tasks.length)} tone={allDone ? 'positive' : 'brand'} className="mb-3" />

              <div className="flex-1 min-h-0">
                {d.tasks.length === 0 ? (
                  <div className="text-[12px] text-ink-muted py-2">No tasks defined for this shift.</div>
                ) : allDone && d.handoff?.notes ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.08em] text-ink-muted font-semibold mb-1">Handoff notes</div>
                    <div className="text-[12px] bg-surface-muted rounded-lg p-2.5 leading-snug text-ink-body">{d.handoff.notes}</div>
                  </div>
                ) : allDone ? (
                  <div className="text-[12px] text-ink-muted py-2">All {d.tasks.length} tasks complete. Add handoff notes from the side sheet.</div>
                ) : (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.08em] text-ink-muted font-semibold mb-1.5">
                      Up next · {upcoming.length} of {d.tasks.length - completed} remaining
                    </div>
                    <ul className="text-[13px] space-y-1">
                      {upcoming.map((t) => (
                        <li key={t.task_id}>
                          <button
                            onClick={() => toggleTask(s.id, t)}
                            className="w-full flex gap-2 items-start text-left px-1 py-1 rounded hover:bg-surface-subtle"
                          >
                            <span className="w-3.5 h-3.5 rounded border border-line-strong shrink-0 mt-0.5" />
                            <span className="text-ink-body">{t.task_text}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <button onClick={() => onOpenShift({ id: s.id, label: s.label, range: s.range, total: d.tasks.length, onChange: load })} className="mt-3 text-[12px] text-brand font-medium hover:underline self-start">
                Open all {d.tasks.length} tasks →
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function pillTone(tone) {
  return tone === 'positive' ? 'bg-positive-tint text-positive'
       : tone === 'warning'  ? 'bg-warning-tint text-warning'
       : tone === 'brand'    ? 'bg-brand-tint text-brand'
                             : 'bg-surface-muted text-ink-body border border-line-subtle'
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
  const { isEnabled } = useFeatureConfig()
  const enabled = isEnabled('dinner', propertyId)
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

  if (!enabled) {
    return (
      <SectionCard title="Dinner orders">
        <Banner tone="info">Dinner orders are disabled for this property. Toggle from Admin.</Banner>
      </SectionCard>
    )
  }

  return (
    <SectionCard
      title="Dinner orders · tonight"
      subtitle="Prep by 6:00 pm"
      actions={<span className="pill bg-brand-tint text-brand">{open} open / {orders.length}</span>}
    >
      {error && <Banner tone="error">{error}</Banner>}
      {formUrl && <div className="mb-3"><CopyLink url={formUrl} label="Guest order form" /></div>}
      {orders.length === 0 ? (
        <div className="text-[14px] text-ink-muted py-10 text-center">No orders today.</div>
      ) : (
        <div className="overflow-x-auto">
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

function ParkFlyPanel({ propertyId }) {
  const api = useApi()
  const [vehicles, setVehicles] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setError('')
      const res = await api.get(`/api/parkfly/${propertyId}`).catch(() => ({ vehicles: [] }))
      setVehicles((res.vehicles || []).slice(0, 6))
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyId])

  async function update(v, patch) {
    try { await api.put(`/api/parkfly/${propertyId}/${v.vehicle_id}`, patch); load() } catch (e) { setError(e.message) }
  }

  const unpaid = vehicles.filter((v) => !v.paid).length

  return (
    <SectionCard
      title="Park & Fly"
      actions={
        <div className="flex items-center gap-2">
          {unpaid > 0 && <span className="text-[11px] text-warning">{unpaid} unpaid</span>}
          <button onClick={() => setShowForm((s) => !s)} className="text-[12px] text-brand font-semibold">{showForm ? 'Cancel' : '+ New'}</button>
        </div>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      {showForm && <NewVehicleForm propertyId={propertyId} onCreated={() => { setShowForm(false); load() }} />}
      {vehicles.length === 0 ? (
        <div className="text-[13px] text-ink-muted py-6 text-center">No active tags.</div>
      ) : (
        <div className="space-y-2 text-[12px]">
          {vehicles.map((v) => (
            <div key={v.vehicle_id} className="flex items-center justify-between border-b border-line-subtle pb-2 last:border-b-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-brand font-semibold">#{v.tag_number}</span>
                  <span className={`pill ${v.paid ? 'bg-positive-tint text-positive' : 'bg-warning-tint text-warning'}`}>{v.paid ? 'Paid' : 'Unpaid'}</span>
                </div>
                <div className="text-[11px] text-ink-muted truncate">{v.guest_name} · {v.vehicle_make_model} · out {v.check_out}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="tabular-nums text-ink-body">${(v.total_fee || 0).toFixed(0)}</span>
                {!v.paid && (
                  <button onClick={() => update(v, { paid: true })} className="text-[10px] text-brand font-semibold">Mark paid</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function NewVehicleForm({ propertyId, onCreated }) {
  const api = useApi()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ guest_name: '', phone: '', check_in: today, check_out: today, vehicle_make_model: '', license_plate: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })) }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await api.post(`/api/parkfly/${propertyId}`, form)
      onCreated?.()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="border border-line-subtle bg-surface-subtle rounded-lg p-3 mb-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input className="input" placeholder="Guest" required value={form.guest_name} onChange={set('guest_name')} />
        <input className="input" placeholder="Phone" value={form.phone} onChange={set('phone')} />
        <input type="date" className="input" required value={form.check_in} onChange={set('check_in')} />
        <input type="date" className="input" required value={form.check_out} onChange={set('check_out')} />
        <input className="input" placeholder="Make / model" required value={form.vehicle_make_model} onChange={set('vehicle_make_model')} />
        <input className="input" placeholder="Plate" required value={form.license_plate} onChange={set('license_plate')} />
      </div>
      {err && <div className="text-danger text-[12px]">{err}</div>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Issue tag'}</button>
    </form>
  )
}

