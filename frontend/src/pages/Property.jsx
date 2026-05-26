import { useEffect, useMemo, useState } from 'react'
import Banner from '../components/Banner'
import CopyLink from '../components/CopyLink'
import ProgressBar from '../components/ProgressBar'
import SectionCard from '../components/SectionCard'
import StatCard from '../components/StatCard'
import {
  CONFIG,
  INSPECTION_CATEGORIES,
  INSPECTION_SEVERITIES,
  ROOM_EQUIPMENT_FIELDS,
} from '../config'
import { useApi } from '../hooks/useApi'
import { useFeatureConfig } from '../hooks/useFeatureConfig'
import { useProperty } from '../hooks/useProperty'

const LENSES = [
  { id: 'cleaning',  label: 'Cleaning' },
  { id: 'condition', label: 'Condition' },
]
const SEVERITY_MAP = Object.fromEntries(INSPECTION_SEVERITIES.map((s) => [s.id, s]))
const CATEGORY_MAP = Object.fromEntries(INSPECTION_CATEGORIES.map((c) => [c.id, c]))

export default function Property() {
  const api = useApi()
  const { propertyId, property } = useProperty()
  const { isEnabled } = useFeatureConfig()
  const inspEnabled = isEnabled('inspections', propertyId)
  const [lens, setLens] = useState('cleaning')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rooms, setRooms] = useState([])
  const [roster, setRoster] = useState([])
  const [assignments, setAssignments] = useState([])
  const [progress, setProgress] = useState(null)
  const [inspRooms, setInspRooms] = useState({})
  const [openIssues, setOpenIssues] = useState({ issues: [], urgent: 0, standard: 0, minor: 0, note: 0, total: 0 })
  const [log, setLog] = useState({ inspections: [], total: 0 })
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [error, setError] = useState('')

  async function loadAll() {
    try {
      setError('')
      const tasks = [
        api.get(`/api/rooms/${propertyId}`).catch(() => ({ rooms: [] })),
        api.get(`/api/housekeeping/${propertyId}/roster`).catch(() => ({ roster: [] })),
        api.get(`/api/housekeeping/${propertyId}/assignments`, { date }).catch(() => ({ assignments: [] })),
        api.get(`/api/housekeeping/${propertyId}/progress`, { date }).catch(() => null),
      ]
      if (inspEnabled) {
        tasks.push(
          api.get(`/api/inspections/${propertyId}/room-status`).catch(() => ({ rooms: {} })),
          api.get(`/api/inspections/${propertyId}/issues/open`).catch(() => ({ issues: [] })),
          api.get(`/api/inspections/${propertyId}/log`, { limit: 12 }).catch(() => ({ inspections: [], total: 0 })),
        )
      }
      const [r, rost, a, prog, ir, oi, lg] = await Promise.all(tasks)
      setRooms(r.rooms || [])
      setRoster(rost.roster || [])
      setAssignments(a.assignments || [])
      setProgress(prog)
      setInspRooms(ir?.rooms || {})
      setOpenIssues(oi || { issues: [], total: 0 })
      setLog(lg || { inspections: [], total: 0 })
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => { loadAll() /* eslint-disable-next-line */ }, [propertyId, date, inspEnabled])

  const hkUrl = CONFIG.publicFormsBaseUrl ? `${CONFIG.publicFormsBaseUrl}/housekeeping.html?p=${propertyId}` : ''
  const inspUrl = inspEnabled && CONFIG.publicFormsBaseUrl ? `${CONFIG.publicFormsBaseUrl}/inspection.html?p=${propertyId}` : ''

  const equipmentByRoom = useMemo(() => {
    const m = new Map()
    rooms.forEach((r) => m.set(String(r.room_number), r))
    return m
  }, [rooms])

  const allRoomNumbers = useMemo(() => {
    const set = new Set()
    rooms.forEach((r) => set.add(String(r.room_number)))
    Object.keys(inspRooms || {}).forEach((rn) => set.add(String(rn)))
    assignments.forEach((a) => set.add(String(a.room_number)))
    return Array.from(set).sort((a, b) => Number(a) - Number(b))
  }, [rooms, inspRooms, assignments])

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="page-title">Housekeeping &amp; Inspections</h1>
          <p className="page-subtitle">{property?.name} · {allRoomNumbers.length} rooms · cleaning assignments and inspection condition on one screen.</p>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input max-w-[180px]" />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {hkUrl && <CopyLink url={hkUrl} label="Housekeeper public form" />}
        {inspUrl && <CopyLink url={inspUrl} label="Inspection walk-form" />}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="seg">
        {LENSES.map((l) => (
          <button
            key={l.id}
            onClick={() => setLens(l.id)}
            className={`seg-btn ${lens === l.id ? 'active' : ''}`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {lens === 'cleaning' && (
        <CleaningView
          propertyId={propertyId}
          date={date}
          roster={roster}
          assignments={assignments}
          progress={progress}
          allRoomNumbers={allRoomNumbers}
          onChanged={loadAll}
          onSelectRoom={setSelectedRoom}
        />
      )}

      {lens === 'condition' && (
        inspEnabled ? (
          <ConditionView
            propertyId={propertyId}
            allRoomNumbers={allRoomNumbers}
            inspRooms={inspRooms}
            openIssues={openIssues}
            log={log}
            onSelectRoom={setSelectedRoom}
            onResolved={loadAll}
          />
        ) : (
          <FeatureOff label="Inspections" />
        )
      )}

      {selectedRoom && (
        <RoomSheet
          roomNumber={selectedRoom}
          room={equipmentByRoom.get(String(selectedRoom))}
          assignment={assignments.find((a) => String(a.room_number) === String(selectedRoom))}
          inspection={inspRooms?.[String(selectedRoom)]}
          openIssues={(openIssues.issues || []).filter((i) => String(i.room_number) === String(selectedRoom))}
          onClose={() => setSelectedRoom(null)}
          onUpdated={loadAll}
          propertyId={propertyId}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* CLEANING                                                               */
/* ---------------------------------------------------------------------- */

function CleaningView({ propertyId, date, roster, assignments, progress, allRoomNumbers, onChanged, onSelectRoom }) {
  const api = useApi()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const byHousekeeper = useMemo(() => {
    const m = new Map()
    roster.forEach((h) => m.set(h.housekeeper_id, { housekeeper: h, items: [] }))
    assignments.forEach((a) => {
      if (!m.has(a.housekeeper_id)) {
        m.set(a.housekeeper_id, { housekeeper: { housekeeper_id: a.housekeeper_id, name: a.housekeeper_name, active: false }, items: [] })
      }
      m.get(a.housekeeper_id).items.push(a)
    })
    return Array.from(m.values())
  }, [roster, assignments])

  const assignedRoomSet = useMemo(() => new Set(assignments.map((a) => String(a.room_number))), [assignments])
  const unassignedRooms = useMemo(
    () => allRoomNumbers.filter((rn) => !assignedRoomSet.has(String(rn))),
    [allRoomNumbers, assignedRoomSet],
  )

  const paceById = useMemo(() => {
    const m = {}
    ;(progress?.housekeepers || []).forEach((h) => { m[h.housekeeper_id] = h })
    return m
  }, [progress])

  const totalAssigned = assignments.length
  const totalDone = assignments.filter((a) => a.status === 'done').length
  const totalPending = totalAssigned - totalDone
  const completionRate = totalAssigned > 0 ? Math.round((totalDone / totalAssigned) * 100) : 0

  async function setStatus(a, status) {
    try {
      await api.put(`/api/housekeeping/${propertyId}/assignments/${a.assignment_id}/status`, { date, status })
      onChanged?.()
    } catch (e) { setError(e.message) }
  }
  async function removeAssignment(a) {
    try {
      await api.del(`/api/housekeeping/${propertyId}/assignments/${a.assignment_id}`, { date })
      onChanged?.()
    } catch (e) { setError(e.message) }
  }
  async function addAssignment(housekeeper_id, room_number) {
    setBusy(true); setError('')
    try {
      await api.post(`/api/housekeeping/${propertyId}/assignments`, { housekeeper_id, room_number, date })
      onChanged?.()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Rooms assigned" value={totalAssigned} />
        <StatCard label="Done" value={totalDone} tone="positive" />
        <StatCard label="Pending" value={totalPending} tone={totalPending > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Completion" value={`${completionRate}%`} tone={completionRate >= 80 ? 'positive' : 'brand'} />
      </div>

      <AssignForm
        roster={roster.filter((r) => r.active)}
        unassignedRooms={unassignedRooms}
        onAdd={addAssignment}
        busy={busy}
      />

      <SectionCard title="Housekeeping assignments" subtitle={date}>
        {byHousekeeper.length === 0 ? (
          <div className="text-[14px] text-ink-muted py-8 text-center">No housekeepers on the roster yet.</div>
        ) : (
          <div className="space-y-4">
            {byHousekeeper.map(({ housekeeper, items }) => {
              const stats = paceById[housekeeper.housekeeper_id]
              const done = items.filter((a) => a.status === 'done').length
              const total = items.length
              const pace = stats?.pace
              return (
                <div key={housekeeper.housekeeper_id} className="border border-line-subtle rounded-lg p-4 bg-surface-subtle">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[15px] font-semibold ${housekeeper.active ? 'text-ink' : 'text-ink-muted line-through'}`}>{housekeeper.name}</span>
                        <PaceBadge pace={pace} done={done} total={total} />
                        {stats?.estimated_finish && stats.estimated_finish !== 'Completed' && (
                          <span className="text-[11px] text-ink-muted">ETA {stats.estimated_finish}</span>
                        )}
                      </div>
                      <div className="text-[12px] text-ink-muted mt-0.5 tabular-nums">{done} / {total} rooms · {total > 0 ? Math.round((done / total) * 100) : 0}%</div>
                    </div>
                  </div>
                  {total > 0 && (
                    <ProgressBar value={done} max={total} tone={done === total ? 'positive' : 'brand'} className="mb-3" />
                  )}
                  {total === 0 ? (
                    <div className="text-[13px] text-ink-muted">No rooms assigned today.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((a) => (
                        <RoomChip
                          key={a.assignment_id}
                          assignment={a}
                          onCycle={(next) => setStatus(a, next)}
                          onRemove={() => removeAssignment(a)}
                          onOpen={() => onSelectRoom(a.room_number)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Unassigned rooms"
        actions={<span className="pill bg-surface-muted text-ink-body border border-line-subtle">{unassignedRooms.length}</span>}
        subtitle="Rooms in the property with no housekeeping assignment for this date."
      >
        {unassignedRooms.length === 0 ? (
          <div className="text-[13px] text-ink-muted py-6 text-center">Every room is assigned. Nice.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {unassignedRooms.map((rn) => (
              <button
                key={rn}
                onClick={() => onSelectRoom(rn)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-line bg-white text-[12px] tabular-nums text-ink-body hover:border-ink-muted"
                title={`Room ${rn} · unassigned`}
              >
                {rn}
              </button>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

function PaceBadge({ pace, done, total }) {
  if (total > 0 && done === total) return <span className="badge-positive">All done</span>
  if (pace === 'fast') return <span className="badge-positive">Ahead</span>
  if (pace === 'slow') return <span className="badge-warning">Behind</span>
  if (pace === 'on_track') return <span className="badge-brand">On track</span>
  return <span className="badge-neutral">Not started</span>
}

function RoomChip({ assignment, onCycle, onRemove, onOpen }) {
  const status = assignment.status
  const next = status === 'open' ? 'in_progress' : status === 'in_progress' ? 'done' : 'open'
  const icon = status === 'open' ? '▷' : status === 'in_progress' ? '✓' : '↺'
  const cls =
    status === 'done'        ? 'bg-positive-tint border-positive/30 text-positive'
  : status === 'in_progress' ? 'bg-brand-tint border-brand/30 text-brand'
                             : 'bg-white border-line text-ink'
  return (
    <div className={`inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full border text-[12px] ${cls}`}>
      <button onClick={onOpen} className="font-medium tabular-nums">{assignment.room_number}</button>
      <button onClick={() => onCycle(next)} title="Cycle status" className="text-[12px] opacity-70 hover:opacity-100 px-1">{icon}</button>
      <button onClick={onRemove} title="Remove" className="text-ink-muted hover:text-danger text-[14px] leading-none px-0.5">×</button>
    </div>
  )
}

function AssignForm({ roster, unassignedRooms, onAdd, busy }) {
  const [housekeeperId, setHousekeeperId] = useState('')
  const [roomsInput, setRoomsInput] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!housekeeperId || !roomsInput.trim()) return
    const list = roomsInput.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean)
    list.forEach((rn) => onAdd(housekeeperId, rn))
    setRoomsInput('')
  }

  return (
    <form onSubmit={submit} className="card bg-surface-subtle">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="label">Housekeeper</label>
          <select className="select" value={housekeeperId} onChange={(e) => setHousekeeperId(e.target.value)}>
            <option value="">Choose…</option>
            {roster.map((h) => <option key={h.housekeeper_id} value={h.housekeeper_id}>{h.name}</option>)}
          </select>
        </div>
        <div className="flex-[2] min-w-[240px]">
          <label className="label">Rooms <span className="text-ink-muted font-normal">({unassignedRooms.length} unassigned)</span></label>
          <input className="input" placeholder="101, 102 205…" value={roomsInput} onChange={(e) => setRoomsInput(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={busy || !housekeeperId || !roomsInput.trim()}>Assign</button>
      </div>
    </form>
  )
}

/* ---------------------------------------------------------------------- */
/* CONDITION                                                              */
/* ---------------------------------------------------------------------- */

function ConditionView({ propertyId, allRoomNumbers, inspRooms, openIssues, log, onSelectRoom, onResolved }) {
  const byFloor = useMemo(() => {
    const out = {}
    for (const rn of allRoomNumbers) {
      const floor = floorOf(rn)
      if (!out[floor]) out[floor] = []
      out[floor].push(rn)
    }
    return out
  }, [allRoomNumbers])

  const counts = useMemo(() => {
    const out = { clear: 0, minor_issues: 0, standard_issues: 0, urgent: 0, never: 0 }
    for (const rn of allRoomNumbers) {
      const r = inspRooms?.[String(rn)]
      const s = !r ? 'never' : r.status === 'never_inspected' ? 'never' : (r.status || 'never')
      if (out[s] != null) out[s] += 1
      else out.never += 1
    }
    return out
  }, [allRoomNumbers, inspRooms])

  const issuesByRoom = useMemo(() => {
    const m = new Map()
    ;(openIssues.issues || []).forEach((i) => {
      const k = String(i.room_number)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(i)
    })
    // sort each room's issues by severity then age
    for (const arr of m.values()) {
      arr.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (b.time_open_hours || 0) - (a.time_open_hours || 0))
    }
    return m
  }, [openIssues])

  return (
    <div className="space-y-5">
      <SectionCard
        title="Floor-by-floor"
        actions={<Legend counts={counts} />}
        subtitle="Color by latest inspection condition. Click a room for detail."
      >
        {allRoomNumbers.length === 0 ? (
          <div className="text-[14px] text-ink-muted py-12 text-center">No rooms yet.</div>
        ) : (
          <div className="space-y-4">
            {Object.keys(byFloor).sort((a, b) => Number(b) - Number(a)).map((floor) => (
              <div key={floor}>
                <div className="text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-1.5">Floor {floor}</div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(54px, 1fr))' }}>
                  {byFloor[floor].map((rn) => {
                    const state = conditionStateFor(rn, inspRooms)
                    return (
                      <button
                        key={rn}
                        onClick={() => onSelectRoom(rn)}
                        title={state.label}
                        className={`rounded-lg text-[12px] font-semibold tabular-nums py-2 px-1 border transition-colors ${state.cls}`}
                      >
                        <div>{rn}</div>
                        {state.badge && <div className="text-[10px] mt-0.5 opacity-80">{state.badge}</div>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <IssuesTable
        issuesByRoom={issuesByRoom}
        openIssues={openIssues}
        propertyId={propertyId}
        onResolved={onResolved}
        onSelectRoom={onSelectRoom}
      />

      <InspectionLog log={log} />
    </div>
  )
}

function severityRank(sev) {
  return ({ urgent: 0, standard: 1, minor: 2, note: 3 })[sev] ?? 4
}

function Legend({ counts }) {
  const items = [
    { dot: 'bg-positive', label: 'Clear', n: counts.clear || 0 },
    { dot: 'bg-brand', label: 'Minor', n: counts.minor_issues || 0 },
    { dot: 'bg-warning', label: 'Standard', n: counts.standard_issues || 0 },
    { dot: 'bg-danger', label: 'Urgent', n: counts.urgent || 0 },
    { dot: 'bg-surface-sunken border border-line', label: 'Never', n: counts.never || 0 },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${it.dot}`} />
          {it.label} <span className="tabular-nums">{it.n}</span>
        </span>
      ))}
    </div>
  )
}

function conditionStateFor(rn, inspRooms) {
  const r = inspRooms?.[String(rn)]
  if (!r) return { cls: 'bg-white border-line-subtle text-ink-body', label: `${rn} · never inspected` }
  const open = r.open_issues || 0
  const badge = open > 0 ? String(open) : null
  if (r.status === 'urgent')          return { cls: 'bg-danger-tint border-transparent text-danger ring-2 ring-danger/30', label: `${rn} · urgent (${open} open)`, badge }
  if (r.status === 'standard_issues') return { cls: 'bg-warning-tint border-transparent text-warning', label: `${rn} · standard issues (${open} open)`, badge }
  if (r.status === 'minor_issues')    return { cls: 'bg-brand-tint border-transparent text-brand', label: `${rn} · minor issues (${open} open)`, badge }
  if (r.status === 'clear')           return { cls: 'bg-positive-tint border-transparent text-positive', label: `${rn} · clear` }
  return { cls: 'bg-surface-muted border-line-subtle text-ink-muted', label: `${rn} · never inspected` }
}

function IssuesTable({ issuesByRoom, openIssues, propertyId, onResolved, onSelectRoom }) {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function setStatus(issue, status) {
    setBusy(true); setError('')
    try {
      const body = { status }
      if (status === 'resolved') {
        body.resolution_notes = window.prompt('Resolution notes (optional):') || ''
      }
      await api.put(`/api/inspections/${propertyId}/issues/${issue.issue_id}/status`, body)
      onResolved?.()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const rows = Array.from(issuesByRoom.entries()).sort(([, a], [, b]) =>
    severityRank(a[0]?.severity) - severityRank(b[0]?.severity)
  )

  return (
    <SectionCard
      title="Open issues by room"
      actions={
        <div className="flex gap-1">
          {openIssues.urgent > 0 && <span className="badge-danger">{openIssues.urgent} urgent</span>}
          {openIssues.standard > 0 && <span className="badge-warning">{openIssues.standard} std</span>}
          {openIssues.minor > 0 && <span className="badge-neutral">{openIssues.minor} minor</span>}
        </div>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      {rows.length === 0 ? (
        <div className="text-[14px] text-ink-muted py-8 text-center">No open issues. Nice.</div>
      ) : (
        <table className="table-clean text-[13px]">
          <thead>
            <tr>
              <th className="w-20">Room</th>
              <th className="w-28">Severity</th>
              <th className="w-32">Category</th>
              <th>Description</th>
              <th className="w-32">Age / SLA</th>
              <th className="w-24 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([roomNumber, issues]) =>
              issues.map((i, idx) => {
                const sev = SEVERITY_MAP[i.severity] || INSPECTION_SEVERITIES[1]
                const cat = CATEGORY_MAP[i.category] || INSPECTION_CATEGORIES[0]
                const sla = i.sla_status
                const slaCls = sla === 'breached' ? 'text-danger' : sla === 'at_risk' ? 'text-warning' : 'text-ink-muted'
                return (
                  <tr key={i.issue_id} className="cursor-pointer" onClick={() => onSelectRoom(roomNumber)}>
                    <td className="tabular-nums font-medium text-ink">{idx === 0 ? roomNumber : ''}</td>
                    <td><span className={`badge-${sev.tone}`}>{sev.label}</span></td>
                    <td className="text-ink-body">{cat.emoji} {cat.label}</td>
                    <td className="text-ink">
                      {i.description}
                      {i.location_in_room && <div className="text-[11px] text-ink-muted">{i.location_in_room}</div>}
                    </td>
                    <td className={`text-[12px] ${slaCls}`}>
                      {Math.round(i.time_open_hours || 0)}h
                      {sla === 'breached' && ' · breached'}
                      {sla === 'at_risk' && ' · at risk'}
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <button disabled={busy} onClick={() => setStatus(i, 'resolved')} className="text-[11px] text-brand font-semibold">Resolve</button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      )}
    </SectionCard>
  )
}

function InspectionLog({ log }) {
  const inspections = log.inspections || []
  return (
    <SectionCard title="Inspection log · last 7 days" subtitle={`${log.total ?? inspections.length} submitted`}>
      {inspections.length === 0 ? (
        <div className="text-[14px] text-ink-muted py-10 text-center">No inspections submitted yet.</div>
      ) : (
        <table className="table-clean text-[13px]">
          <thead>
            <tr>
              <th className="w-36">When</th>
              <th className="w-20">Room</th>
              <th className="w-32">Type</th>
              <th>Inspector</th>
              <th className="w-24">Condition</th>
              <th className="w-20 text-right">Issues</th>
            </tr>
          </thead>
          <tbody>
            {inspections.slice(0, 10).map((i) => (
              <tr key={i.inspection_id}>
                <td className="text-[12px] text-ink-muted">{i.submitted_at ? new Date(i.submitted_at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                <td className="tabular-nums font-medium">{i.room_number}</td>
                <td>{i.inspection_type}</td>
                <td className="text-ink-body">{i.inspector_name || '—'}</td>
                <td>{i.overall_condition ? <span className={conditionBadge(i.overall_condition)}>{i.overall_condition}</span> : '—'}</td>
                <td className="text-right tabular-nums">
                  {i.issues_count}
                  {i.open_issues_count > 0 && <span className="text-warning ml-1">({i.open_issues_count})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  )
}

function conditionBadge(c) {
  return ({ excellent: 'badge-positive', good: 'badge-brand', fair: 'badge-warning', poor: 'badge-danger' })[c] || 'badge-neutral'
}

function FeatureOff({ label }) {
  return (
    <div className="card text-[13px] text-ink-muted">
      <strong className="block text-ink mb-1">{label} disabled</strong>
      Switch it on from the Admin tab to use this lens.
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* SHARED                                                                 */
/* ---------------------------------------------------------------------- */

function floorOf(roomNumber) {
  const n = String(roomNumber)
  if (n.length >= 3) return n[0]
  return '1'
}

function RoomSheet({ roomNumber, room, assignment, inspection, openIssues, onClose, onUpdated, propertyId }) {
  const api = useApi()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function updateField(field, value) {
    setSaving(true); setError('')
    try {
      await api.put(`/api/rooms/${propertyId}/${roomNumber}`, { [field]: value })
      onUpdated?.()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white sm:rounded-2xl rounded-t-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-line-subtle px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[20px] font-semibold tracking-tight text-ink tabular-nums">Room {roomNumber}</div>
            <div className="text-[12px] text-ink-muted mt-0.5">
              {assignment ? `Assigned to ${assignment.housekeeper_name} · ${assignment.status}` : 'No housekeeping assignment today'}
            </div>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink text-2xl w-8 h-8 grid place-items-center rounded-full hover:bg-surface-muted">×</button>
        </div>
        <div className="p-6 space-y-5">
          {error && <Banner tone="error">{error}</Banner>}

          {inspection && (
            <div>
              <h3 className="text-[13px] uppercase tracking-[0.06em] text-ink-muted mb-2">Latest inspection</h3>
              <div className="text-[14px] text-ink">{inspection.status || 'never_inspected'} · {inspection.open_issues || 0} open issue{inspection.open_issues === 1 ? '' : 's'}</div>
              {inspection.last_inspection_date && <div className="text-[12px] text-ink-muted">Last: {inspection.last_inspection_date}</div>}
            </div>
          )}

          {openIssues.length > 0 && (
            <div>
              <h3 className="text-[13px] uppercase tracking-[0.06em] text-ink-muted mb-2">Open issues</h3>
              <ul className="space-y-2">
                {openIssues.map((i) => {
                  const sev = SEVERITY_MAP[i.severity] || INSPECTION_SEVERITIES[1]
                  return (
                    <li key={i.issue_id} className="text-[13px]">
                      <span className={`badge-${sev.tone} mr-2`}>{sev.label}</span>
                      {i.description}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {room && (
            <div>
              <h3 className="text-[13px] uppercase tracking-[0.06em] text-ink-muted mb-2">Equipment</h3>
              <div className="space-y-2.5">
                {ROOM_EQUIPMENT_FIELDS.map((f) => (
                  <div key={f.id} className="grid grid-cols-[150px,1fr] items-center gap-3">
                    <label className="text-[13px] text-ink-body">{f.label}</label>
                    <input
                      className="input"
                      defaultValue={room[f.id] || ''}
                      placeholder="yes / no / note"
                      onBlur={(e) => { if (e.target.value !== (room[f.id] || '')) updateField(f.id, e.target.value) }}
                    />
                  </div>
                ))}
                <div className="grid grid-cols-[150px,1fr] items-start gap-3">
                  <label className="text-[13px] text-ink-body pt-2">Notes</label>
                  <textarea
                    className="textarea min-h-[70px]"
                    defaultValue={room.notes || ''}
                    onBlur={(e) => { if (e.target.value !== (room.notes || '')) updateField('notes', e.target.value) }}
                  />
                </div>
              </div>
            </div>
          )}
          {saving && <div className="text-[12px] text-ink-muted">Saving…</div>}
        </div>
      </div>
    </div>
  )
}
