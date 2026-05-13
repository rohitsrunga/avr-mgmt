import { useEffect, useMemo, useState } from 'react'
import Banner from '../components/Banner'
import { ROOM_EQUIPMENT_FIELDS } from '../config'
import { useApi } from '../hooks/useApi'
import { useProperty } from '../hooks/useProperty'

const ISSUE_VALUES = new Set(['no', 'Not Attached', 'Melting', 'old'])

export default function Rooms() {
  const api = useApi()
  const { propertyId } = useProperty()
  const [rooms, setRooms] = useState([])
  const [showIssuesOnly, setShowIssuesOnly] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      setError('')
      const res = await api.get(`/api/rooms/${propertyId}`)
      setRooms(res.rooms || [])
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => { load() }, [propertyId])

  const filtered = useMemo(() =>
    showIssuesOnly ? rooms.filter((r) => r.has_issue) : rooms,
    [rooms, showIssuesOnly]
  )

  async function update(room, field, value) {
    setRooms((rs) => rs.map((r) => r.room_number === room.room_number ? { ...r, [field]: value } : r))
    try {
      await api.put(`/api/rooms/${propertyId}/${room.room_number}`, { [field]: value })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="page-title">Rooms</h1>
          <p className="page-subtitle">Per-room equipment audit and maintenance notes.</p>
        </div>
        <label className="flex items-center gap-2 text-[14px] cursor-pointer text-ink-body">
          <input
            type="checkbox"
            checked={showIssuesOnly}
            onChange={(e) => setShowIssuesOnly(e.target.checked)}
            className="w-4 h-4 accent-brand"
          />
          Issues only
        </label>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {filtered.length === 0 ? (
        <div className="card text-center text-ink-muted py-12 text-[14px]">
          {rooms.length === 0 ? 'No rooms yet. Add rooms via the admin panel.' : 'No rooms with issues.'}
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-ink-muted">
                <th className="text-left px-3 py-2.5 sticky left-0 bg-white border-b border-line-subtle font-medium uppercase tracking-[0.06em]">Room</th>
                {ROOM_EQUIPMENT_FIELDS.map((f) => (
                  <th key={f.id} className="px-2 py-2.5 text-center whitespace-nowrap border-b border-line-subtle font-medium uppercase tracking-[0.06em]">{f.label}</th>
                ))}
                <th className="px-3 py-2.5 text-left border-b border-line-subtle font-medium uppercase tracking-[0.06em]">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((room) => (
                <tr
                  key={room.room_number}
                  className={`${room.has_issue ? 'bg-danger-tint/30' : ''} cursor-pointer hover:bg-surface-subtle`}
                  onClick={() => setExpanded(expanded === room.room_number ? null : room.room_number)}
                >
                  <td className="px-3 py-2.5 sticky left-0 bg-white tabular-nums font-medium text-ink border-b border-line-subtle">{room.room_number}</td>
                  {ROOM_EQUIPMENT_FIELDS.map((f) => {
                    const v = room[f.id] || ''
                    const isIssue = ISSUE_VALUES.has(v)
                    return (
                      <td key={f.id} className={`px-2 py-2.5 text-center whitespace-nowrap border-b border-line-subtle ${isIssue ? 'text-danger font-medium' : v === 'yes' ? 'text-positive' : 'text-ink-faint'}`}>
                        {renderEquipment(v)}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 max-w-[200px] truncate text-ink-body border-b border-line-subtle">{room.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {expanded && (
        <RoomDetail
          key={expanded}
          room={rooms.find((r) => r.room_number === expanded)}
          onClose={() => setExpanded(null)}
          onUpdate={(field, value) => update({ room_number: expanded }, field, value)}
        />
      )}
    </div>
  )
}

function renderEquipment(v) {
  if (!v) return '—'
  if (v === 'yes') return '✓'
  if (v === 'no') return '✕'
  return v
}

function RoomDetail({ room, onClose, onUpdate }) {
  if (!room) return null
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white sm:rounded-2xl rounded-t-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-line-subtle px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[20px] font-semibold tracking-tight text-ink">Room {room.room_number}</div>
            {room.last_audited && (
              <div className="text-[12px] text-ink-muted mt-0.5">
                Audited {new Date(room.last_audited).toLocaleString()} by {room.audited_by}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-muted">×</button>
        </div>
        <div className="p-6 space-y-3">
          {ROOM_EQUIPMENT_FIELDS.map((f) => (
            <div key={f.id} className="grid grid-cols-[140px,1fr] gap-3 items-center">
              <label className="text-[14px] text-ink-body">{f.label}</label>
              <input
                className="input"
                defaultValue={room[f.id] || ''}
                onBlur={(e) => {
                  if (e.target.value !== (room[f.id] || '')) onUpdate(f.id, e.target.value)
                }}
                placeholder='yes / no / note'
              />
            </div>
          ))}
          <div className="grid grid-cols-[140px,1fr] gap-3 items-start">
            <label className="text-[14px] text-ink-body pt-2">Notes</label>
            <textarea
              className="textarea min-h-[80px]"
              defaultValue={room.notes || ''}
              onBlur={(e) => {
                if (e.target.value !== (room.notes || '')) onUpdate('notes', e.target.value)
              }}
              placeholder="Maintenance issues, special notes…"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
