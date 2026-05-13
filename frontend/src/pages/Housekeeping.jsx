import { useEffect, useMemo, useState } from 'react'
import Banner from '../components/Banner'
import { CONFIG } from '../config'
import { useApi } from '../hooks/useApi'
import { useProperty } from '../hooks/useProperty'

export default function Housekeeping() {
  const api = useApi()
  const { propertyId, property } = useProperty()
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [roster, setRoster] = useState([])
  const [assignments, setAssignments] = useState([])
  const [error, setError] = useState('')

  async function loadAll() {
    try {
      setError('')
      const [r, a] = await Promise.all([
        api.get(`/api/housekeeping/${propertyId}/roster`),
        api.get(`/api/housekeeping/${propertyId}/assignments`, { date }),
      ])
      setRoster(r.roster || [])
      setAssignments(a.assignments || [])
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => { loadAll() }, [propertyId, date])

  async function addHousekeeper(name) {
    try {
      await api.post(`/api/housekeeping/${propertyId}/roster`, { name })
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  async function toggleActive(h) {
    try {
      await api.put(`/api/housekeeping/${propertyId}/roster/${h.housekeeper_id}`, { active: !h.active })
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  async function removeHousekeeper(h) {
    if (!confirm(`Remove ${h.name} from roster? Any assignments stay but become orphaned.`)) return
    try {
      await api.del(`/api/housekeeping/${propertyId}/roster/${h.housekeeper_id}`)
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  async function addAssignment(housekeeper_id, room_number) {
    try {
      await api.post(`/api/housekeeping/${propertyId}/assignments`, { housekeeper_id, room_number, date })
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  async function removeAssignment(a) {
    try {
      await api.del(`/api/housekeeping/${propertyId}/assignments/${a.assignment_id}`, { date })
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const grouped = useMemo(() => {
    const map = new Map()
    for (const h of roster.filter((r) => r.active)) {
      map.set(h.housekeeper_id, { housekeeper: h, items: [] })
    }
    for (const a of assignments) {
      if (!map.has(a.housekeeper_id)) {
        map.set(a.housekeeper_id, {
          housekeeper: { housekeeper_id: a.housekeeper_id, name: a.housekeeper_name, active: false },
          items: [],
        })
      }
      map.get(a.housekeeper_id).items.push(a)
    }
    return Array.from(map.values())
  }, [roster, assignments])

  const formUrl = CONFIG.publicFormsBaseUrl
    ? `${CONFIG.publicFormsBaseUrl}/housekeeping.html?p=${propertyId}`
    : ''

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="page-title">Housekeeping</h1>
          <p className="page-subtitle">{property?.name} · roster and daily room assignments.</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input max-w-[180px]"
        />
      </div>

      {formUrl && <PublicFormCard url={formUrl} label="Housekeeper form (share with staff)" />}

      {error && <Banner tone="error">{error}</Banner>}

      <div className="grid lg:grid-cols-[320px,1fr] gap-5">
        <RosterCard
          roster={roster}
          onAdd={addHousekeeper}
          onToggle={toggleActive}
          onRemove={removeHousekeeper}
        />
        <AssignmentsCard
          date={date}
          grouped={grouped}
          activeRoster={roster.filter((r) => r.active)}
          onAdd={addAssignment}
          onRemove={removeAssignment}
        />
      </div>
    </div>
  )
}

function PublicFormCard({ url, label }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }
  return (
    <div className="card flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-ink-muted">{label}</div>
        <a href={url} target="_blank" rel="noreferrer" className="text-[14px] text-brand font-mono truncate block hover:underline">
          {url}
        </a>
      </div>
      <button onClick={copy} className="btn-secondary text-[13px] px-3 py-1.5 min-h-0">
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}

function RosterCard({ roster, onAdd, onToggle, onRemove }) {
  const [name, setName] = useState('')
  function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onAdd(name.trim())
    setName('')
  }
  return (
    <div className="card h-fit">
      <h2 className="section-title mb-4">Roster</h2>
      <form onSubmit={submit} className="flex gap-2 mb-4">
        <input
          className="input flex-1"
          placeholder="Add housekeeper name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn-primary">Add</button>
      </form>
      {roster.length === 0 ? (
        <div className="text-[14px] text-ink-muted py-6 text-center">No housekeepers yet.</div>
      ) : (
        <ul className="divide-y divide-line-subtle -mx-2">
          {roster.map((h) => (
            <li key={h.housekeeper_id} className="px-2 py-2.5 flex items-center gap-2">
              <div className="flex-1">
                <div className={`text-[14px] ${h.active ? 'text-ink' : 'text-ink-muted line-through'}`}>{h.name}</div>
              </div>
              <button
                onClick={() => onToggle(h)}
                className="text-[12px] text-ink-body hover:text-ink"
                title={h.active ? 'Deactivate' : 'Activate'}
              >
                {h.active ? 'Active' : 'Inactive'}
              </button>
              <button
                onClick={() => onRemove(h)}
                className="text-ink-muted hover:text-danger text-[18px] leading-none ml-1"
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AssignmentsCard({ date, grouped, activeRoster, onAdd, onRemove }) {
  const totalRooms = grouped.reduce((sum, g) => sum + g.items.length, 0)
  const totalDone = grouped.reduce((sum, g) => sum + g.items.filter((a) => a.status === 'done').length, 0)
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="section-title">Assignments</h2>
          <p className="text-[13px] text-ink-muted mt-0.5">{date}</p>
        </div>
        <div className="text-[13px] text-ink-body tabular-nums">{totalDone} / {totalRooms} done</div>
      </div>

      <AssignForm activeRoster={activeRoster} onAdd={onAdd} />

      {grouped.length === 0 ? (
        <div className="text-[14px] text-ink-muted py-6 text-center mt-4">
          No active housekeepers. Add one from the roster.
        </div>
      ) : (
        <div className="space-y-4 mt-5">
          {grouped.map(({ housekeeper, items }) => (
            <div key={housekeeper.housekeeper_id}>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[15px] font-medium text-ink">{housekeeper.name}</div>
                <div className="text-[12px] text-ink-muted tabular-nums">
                  {items.filter((a) => a.status === 'done').length} / {items.length}
                </div>
              </div>
              {items.length === 0 ? (
                <div className="text-[13px] text-ink-muted pl-2">No rooms assigned.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {items.map((a) => (
                    <div
                      key={a.assignment_id}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] ${
                        a.status === 'done'
                          ? 'bg-positive-tint border-positive/20 text-positive'
                          : 'bg-white border-line text-ink'
                      }`}
                    >
                      <span className="font-medium tabular-nums">{a.room_number}</span>
                      <button
                        onClick={() => onRemove(a)}
                        className="text-ink-muted hover:text-danger text-[16px] leading-none"
                        title="Remove assignment"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AssignForm({ activeRoster, onAdd }) {
  const [housekeeper_id, setHousekeeper] = useState('')
  const [rooms, setRooms] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!housekeeper_id || !rooms.trim()) return
    const list = rooms.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean)
    list.forEach((r) => onAdd(housekeeper_id, r))
    setRooms('')
  }

  return (
    <form onSubmit={submit} className="grid sm:grid-cols-[1fr,1fr,auto] gap-2 bg-surface-subtle border border-line-subtle rounded-lg p-3">
      <select className="select" value={housekeeper_id} onChange={(e) => setHousekeeper(e.target.value)}>
        <option value="">Choose housekeeper…</option>
        {activeRoster.map((h) => <option key={h.housekeeper_id} value={h.housekeeper_id}>{h.name}</option>)}
      </select>
      <input
        className="input"
        placeholder="Room numbers (e.g. 101, 102 105)"
        value={rooms}
        onChange={(e) => setRooms(e.target.value)}
      />
      <button className="btn-primary" disabled={!housekeeper_id || !rooms.trim()}>Assign</button>
    </form>
  )
}
