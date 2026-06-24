import { useEffect, useMemo, useState } from 'react'
import Banner from '../components/Banner'
import CopyLink from '../components/CopyLink'
import ProgressBar from '../components/ProgressBar'
import SectionCard from '../components/SectionCard'
import {
  CONFIG,
  INSPECTION_SEVERITIES,
  ROOM_EQUIPMENT_FIELDS,
} from '../config'
import NotesAndIssues from '../components/NotesAndIssues'
import { useApi } from '../hooks/useApi'
import { useFeatureConfig } from '../hooks/useFeatureConfig'
import { useProperty } from '../hooks/useProperty'

const SEVERITY_MAP = Object.fromEntries(INSPECTION_SEVERITIES.map((s) => [s.id, s]))

export default function Property() {
  const api = useApi()
  const { propertyId, property } = useProperty()
  const { isEnabled } = useFeatureConfig()
  const inspEnabled = isEnabled('inspections', propertyId)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rooms, setRooms] = useState([])
  const [roster, setRoster] = useState([])
  const [assignments, setAssignments] = useState([])
  const [progress, setProgress] = useState(null)
  const [inspRooms, setInspRooms] = useState({})
  const [openIssues, setOpenIssues] = useState({ issues: [], urgent: 0, standard: 0, minor: 0, note: 0, total: 0 })
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [cloudbeds, setCloudbeds] = useState({ rooms: [], dirty: [], departures: [], inhouse: [], clean: [], synced_at: '' })
  const [error, setError] = useState('')

  async function loadAll() {
    try {
      setError('')
      const tasks = [
        api.get(`/api/rooms/${propertyId}`).catch(() => ({ rooms: [] })),
        api.get(`/api/housekeeping/${propertyId}/roster`).catch(() => ({ roster: [] })),
        api.get(`/api/housekeeping/${propertyId}/assignments`, { date }).catch(() => ({ assignments: [] })),
        api.get(`/api/housekeeping/${propertyId}/progress`, { date }).catch(() => null),
        api.get(`/api/reports/${propertyId}/rooms-to-clean`).catch(() => ({ rooms: [], dirty: [], departures: [], inhouse: [], clean: [], synced_at: '' })),
      ]
      if (inspEnabled) {
        tasks.push(
          api.get(`/api/inspections/${propertyId}/room-status`).catch(() => ({ rooms: {} })),
          api.get(`/api/inspections/${propertyId}/issues/open`).catch(() => ({ issues: [] })),
        )
      }
      const [r, rost, a, prog, cb, ir, oi] = await Promise.all(tasks)
      setRooms(r.rooms || [])
      setRoster(rost.roster || [])
      setAssignments(a.assignments || [])
      setProgress(prog)
      setCloudbeds(cb || { rooms: [], dirty: [], departures: [], inhouse: [], clean: [], synced_at: '' })
      setInspRooms(ir?.rooms || {})
      setOpenIssues(oi || { issues: [], total: 0 })
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
          <p className="page-subtitle">{property?.name} · {allRoomNumbers.length} rooms · cleaning assignments, open issues, and shared notes on one screen.</p>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input max-w-[180px]" />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {hkUrl && <CopyLink url={hkUrl} label="Housekeeper public form" />}
        {inspUrl && <CopyLink url={inspUrl} label="Inspection walk-form" />}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <CleaningView
        propertyId={propertyId}
        date={date}
        roster={roster}
        assignments={assignments}
        progress={progress}
        allRoomNumbers={allRoomNumbers}
        cloudbeds={cloudbeds}
        onChanged={loadAll}
        onSelectRoom={setSelectedRoom}
      />

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

function CleaningView({ propertyId, date, roster, assignments, progress, allRoomNumbers, cloudbeds, onChanged, onSelectRoom }) {
  const api = useApi()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)

  async function refreshCloudbeds() {
    setSyncing(true); setError('')
    try {
      const res = await api.post('/api/sync/cloudbeds', {})
      const status = res?.results?.[propertyId]
      if (status && status !== 'ok') setError(`Cloudbeds sync: ${status}`)
      await onChanged?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }

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

  // "Rooms that need to be assigned" = Cloudbeds' union of today's departures
  // + Cloudbeds-flagged dirty/pickup, minus rooms already assigned. Falls
  // back to (all property rooms minus assigned) when Cloudbeds isn't wired
  // up yet for this property.
  const cbRooms = useMemo(() => cloudbeds?.rooms || [], [cloudbeds])
  const cbConnected = !!(cloudbeds && cloudbeds.synced_at)
  const cbDepartures = useMemo(() => new Set((cloudbeds?.departures || []).map(String)), [cloudbeds])
  const cbDirty = useMemo(() => new Set((cloudbeds?.dirty || []).map(String)), [cloudbeds])
  const cbInhouse = useMemo(() => new Set((cloudbeds?.inhouse || []).map(String)), [cloudbeds])
  const cbClean = useMemo(() => new Set((cloudbeds?.clean || []).map(String)), [cloudbeds])
  const unassignedRooms = useMemo(() => {
    const source = cbConnected ? cbRooms : allRoomNumbers
    return source.map(String).filter((rn) => !assignedRoomSet.has(rn)).sort((a, b) => Number(a) - Number(b))
  }, [cbConnected, cbRooms, allRoomNumbers, assignedRoomSet])

  // Click-to-assign UX: pick a housekeeper container on the left, then
  // click rooms on the right to add them. Null = picker behaves like the
  // legacy text-input flow's "no target" — clicking a room opens the
  // detail sheet instead of assigning.
  const [selectedHkId, setSelectedHkId] = useState(null)
  // Drop the selection if the selected housekeeper leaves the roster.
  useEffect(() => {
    if (selectedHkId && !roster.some((h) => h.housekeeper_id === selectedHkId)) {
      setSelectedHkId(null)
    }
  }, [roster, selectedHkId])

  async function handleRoomClick(rn) {
    if (selectedHkId) {
      await addAssignment(selectedHkId, rn)
    } else {
      onSelectRoom(rn)
    }
  }

  const paceById = useMemo(() => {
    const m = {}
    ;(progress?.housekeepers || []).forEach((h) => { m[h.housekeeper_id] = h })
    return m
  }, [progress])

  const totalAssigned = assignments.length
  const totalDone = assignments.filter((a) => a.status === 'done').length
  const totalInProgress = assignments.filter((a) => a.status === 'in_progress').length
  const totalPending = assignments.filter((a) => a.status === 'open').length
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:items-stretch">
        <CleaningBAN
          completionRate={completionRate}
          totalAssigned={totalAssigned}
          totalDone={totalDone}
          totalInProgress={totalInProgress}
          totalPending={totalPending}
        />
        <NotesAndIssues propertyId={propertyId} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* LEFT — housekeeper containers (click to select, then add rooms) */}
        <SectionCard
          title="Housekeepers"
          subtitle={selectedHkId ? 'Click rooms on the right to assign them.' : 'Pick a housekeeper, then click rooms on the right to assign.'}
        >
          {byHousekeeper.length === 0 ? (
            <div className="text-[14px] text-ink-muted py-8 text-center">No housekeepers on the roster yet.</div>
          ) : (
            <div className="space-y-3">
              {byHousekeeper.map(({ housekeeper, items }) => {
                const stats = paceById[housekeeper.housekeeper_id]
                const done = items.filter((a) => a.status === 'done').length
                const total = items.length
                const pace = stats?.pace
                const isSelected = selectedHkId === housekeeper.housekeeper_id
                const canSelect = housekeeper.active
                return (
                  <div
                    key={housekeeper.housekeeper_id}
                    onClick={() => canSelect && setSelectedHkId(isSelected ? null : housekeeper.housekeeper_id)}
                    role="button"
                    tabIndex={canSelect ? 0 : -1}
                    aria-pressed={isSelected}
                    className={`rounded-lg p-4 transition-colors ${
                      isSelected
                        ? 'border-2 border-brand bg-brand-tint/40 ring-2 ring-brand/20'
                        : 'border border-line-subtle bg-surface-subtle'
                    } ${canSelect ? 'cursor-pointer hover:border-brand/40' : 'opacity-70'}`}
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[15px] font-semibold ${housekeeper.active ? 'text-ink' : 'text-ink-muted line-through'}`}>{housekeeper.name}</span>
                          <PaceBadge pace={pace} done={done} total={total} />
                          {stats?.estimated_finish && stats.estimated_finish !== 'Completed' && (
                            <span className="text-[11px] text-ink-muted">ETA {stats.estimated_finish}</span>
                          )}
                          {isSelected && <span className="badge-brand">Selected</span>}
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
                      <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                        {items.map((a) => (
                          <RoomChip
                            key={a.assignment_id}
                            assignment={a}
                            onCycle={(next) => setStatus(a, next)}
                            onRemove={() => removeAssignment(a)}
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

        {/* RIGHT — room picker */}
        <SectionCard
          title="Rooms to assign"
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refreshCloudbeds}
                disabled={syncing}
                className="text-[12px] font-medium text-brand hover:text-brand-strong disabled:text-ink-muted disabled:cursor-wait"
                title="Pull the latest dirty/departures snapshot from Cloudbeds"
              >
                {syncing ? 'Syncing…' : 'Refresh'}
              </button>
              <span className="pill bg-surface-muted text-ink-body border border-line-subtle">{unassignedRooms.length}</span>
            </div>
          }
          subtitle={
            cbConnected
              ? selectedHkId
                ? `Click a room to assign it to ${roster.find((r) => r.housekeeper_id === selectedHkId)?.name || 'the selected housekeeper'}.`
                : `From Cloudbeds · synced ${timeAgo(cloudbeds.synced_at)}`
              : 'Cloudbeds not connected — falling back to every room in the property minus assigned'
          }
        >
          {cbConnected && <RoomLegend />}
          {unassignedRooms.length === 0 ? (
            <div className="text-[13px] text-ink-muted py-6 text-center">
              {cbConnected ? 'Cloudbeds shows nothing needing cleaning today.' : 'Every room is assigned. Nice.'}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 mt-3">
              {unassignedRooms.map((rn) => {
                const isDep = cbDepartures.has(rn)
                const isDirty = cbDirty.has(rn)
                const isInhouse = cbInhouse.has(rn)
                const isClean = cbClean.has(rn)
                const titleBits = []
                if (isDep) titleBits.push('departing today')
                if (isDirty) titleBits.push('Cloudbeds: dirty')
                if (isInhouse) titleBits.push('in house (stayover)')
                if (isClean) titleBits.push('clean & vacant')
                const title = `Room ${rn}${titleBits.length ? ' · ' + titleBits.join(' · ') : ''}`
                return (
                  <PickerRoom
                    key={rn}
                    rn={rn}
                    isDep={isDep}
                    isDirty={isDirty}
                    isInhouse={isInhouse}
                    isClean={isClean}
                    cbConnected={cbConnected}
                    onClick={() => handleRoomClick(rn)}
                    busy={busy}
                    title={title}
                  />
                )
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

function RoomLegend() {
  const items = [
    { label: 'Dirty',     cls: 'bg-danger-tint border-danger/30 text-danger' },
    { label: 'Departure', cls: 'bg-warning-tint border-warning/30 text-warning' },
    { label: 'Clean',     cls: 'bg-brand-tint border-brand/30 text-brand' },
    { label: 'In house',  cls: 'bg-surface-muted border-line text-ink-muted' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
      {items.map((i) => (
        <span key={i.label} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${i.cls}`}>
          <span className="font-medium">{i.label}</span>
        </span>
      ))}
    </div>
  )
}

function PickerRoom({ rn, isDep, isDirty, isInhouse, isClean, cbConnected, onClick, busy, title }) {
  // Color priority (most → least urgent): dirty > departing > clean > in-house.
  // Dirty+departing (turnover) shows as dirty — most actionable for
  // housekeeping. Clean+departing (rare, e.g., guest checked out and
  // housekeeper already cleaned) shows as departing. The hover title
  // surfaces every flag so nothing is hidden.
  let cls = 'bg-white border-line text-ink-body hover:border-ink-muted'
  if (cbConnected) {
    if (isDirty)        cls = 'bg-danger-tint border-danger/30 text-danger hover:border-danger'
    else if (isDep)     cls = 'bg-warning-tint border-warning/30 text-warning hover:border-warning'
    else if (isClean)   cls = 'bg-brand-tint border-brand/30 text-brand hover:border-brand'
    else if (isInhouse) cls = 'bg-surface-muted border-line text-ink-muted hover:border-ink-muted'
  }
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      className={`w-12 h-10 rounded-md border text-[13px] font-medium tabular-nums transition-colors disabled:opacity-60 disabled:cursor-wait ${cls}`}
    >
      {rn}
    </button>
  )
}

function PaceBadge({ pace, done, total }) {
  if (total > 0 && done === total) return <span className="badge-positive">All done</span>
  if (pace === 'fast') return <span className="badge-positive">Ahead</span>
  if (pace === 'slow') return <span className="badge-warning">Behind</span>
  if (pace === 'on_track') return <span className="badge-brand">On track</span>
  return <span className="badge-neutral">Not started</span>
}

function RoomChip({ assignment, onCycle, onRemove }) {
  const status = assignment.status
  const next = status === 'open' ? 'in_progress' : status === 'in_progress' ? 'done' : 'open'
  const cls =
    status === 'done'        ? 'bg-positive-tint border-positive/30 text-positive'
  : status === 'in_progress' ? 'bg-brand-tint border-brand/30 text-brand'
                             : 'bg-white border-line text-ink'
  const title = `Room ${assignment.room_number} · ${status.replace('_', ' ')} · click to cycle status`
  return (
    <div className={`relative inline-block`}>
      <button
        onClick={() => onCycle(next)}
        title={title}
        className={`w-12 h-10 rounded-md border text-[13px] font-medium tabular-nums hover:brightness-95 ${cls}`}
      >
        {assignment.room_number}
      </button>
      <button
        onClick={onRemove}
        title="Unassign"
        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-line text-ink-muted hover:text-danger hover:border-danger flex items-center justify-center text-[10px] leading-none shadow-sm"
      >
        ×
      </button>
    </div>
  )
}

// Consolidated cleaning-progress BAN. Sized to match the taller Open-issues
// and Shared-notes cells beside it, so the breakdown rows fill the height.
function CleaningBAN({ completionRate, totalAssigned, totalDone, totalInProgress, totalPending }) {
  const toneClass = completionRate >= 80 ? 'text-positive' : 'text-brand'
  const rows = [
    { label: 'Rooms assigned', value: totalAssigned, tone: 'text-ink' },
    { label: 'Done', value: totalDone, tone: 'text-positive' },
    { label: 'In progress', value: totalInProgress, tone: 'text-brand' },
    { label: 'Pending', value: totalPending, tone: totalPending > 0 ? 'text-warning' : 'text-ink-muted' },
  ]
  return (
    <div className="card h-full flex flex-col">
      <div className="text-[15px] font-semibold tracking-tight text-ink">Cleaning progress</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-[52px] leading-none font-semibold tracking-tight tabular-nums ${toneClass}`}>{completionRate}%</span>
        <span className="text-[15px] text-ink-muted">complete</span>
      </div>
      <ProgressBar value={totalDone} max={Math.max(1, totalAssigned)} tone={completionRate >= 80 ? 'positive' : 'brand'} className="mt-4" />
      <div className="mt-5 flex-1 flex flex-col justify-center divide-y divide-line-subtle">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between py-3">
            <span className="text-[15px] text-ink-body">{r.label}</span>
            <span className={`text-[24px] font-semibold tabular-nums ${r.tone}`}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* SHARED                                                                 */
/* ---------------------------------------------------------------------- */

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
