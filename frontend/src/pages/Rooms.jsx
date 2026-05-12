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
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold flex-1">Rooms</h1>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={showIssuesOnly} onChange={(e) => setShowIssuesOnly(e.target.checked)} className="w-4 h-4 accent-accent-teal" />
          Show only rooms with issues
        </label>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {filtered.length === 0 ? (
        <div className="card text-center text-text-muted py-10">
          {rooms.length === 0 ? 'No rooms yet. Add rooms via the admin panel.' : 'No rooms with issues.'}
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-ink-900 text-text-secondary uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2 sticky left-0 bg-ink-900">Room</th>
                {ROOM_EQUIPMENT_FIELDS.map((f) => (
                  <th key={f.id} className="px-2 py-2 text-center whitespace-nowrap">{f.label}</th>
                ))}
                <th className="px-3 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {filtered.map((room) => (
                <tr
                  key={room.room_number}
                  className={`${room.has_issue ? 'bg-accent-red/5' : ''} cursor-pointer hover:bg-ink-700/30`}
                  onClick={() => setExpanded(expanded === room.room_number ? null : room.room_number)}
                >
                  <td className="px-3 py-2 sticky left-0 bg-ink-800 font-mono font-semibold">{room.room_number}</td>
                  {ROOM_EQUIPMENT_FIELDS.map((f) => {
                    const v = room[f.id] || ''
                    const isIssue = ISSUE_VALUES.has(v)
                    return (
                      <td key={f.id} className={`px-2 py-2 text-center whitespace-nowrap ${isIssue ? 'text-accent-red font-medium' : v === 'yes' ? 'text-accent-teal' : 'text-text-muted'}`}>
                        {renderEquipment(v)}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 max-w-[200px] truncate text-text-secondary">{room.notes || '—'}</td>
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
    <div className="fixed inset-0 bg-black/60 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-ink-800 border-t sm:border border-ink-700 sm:rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-ink-800 border-b border-ink-700 px-5 py-3 flex items-center justify-between">
          <div>
            <div className="font-display text-xl font-semibold">Room {room.room_number}</div>
            {room.last_audited && (
              <div className="tag">Audited {new Date(room.last_audited).toLocaleString()} by {room.audited_by}</div>
            )}
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-2xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          {ROOM_EQUIPMENT_FIELDS.map((f) => (
            <div key={f.id} className="grid grid-cols-[140px,1fr] gap-3 items-center">
              <label className="text-sm text-text-secondary">{f.label}</label>
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
            <label className="text-sm text-text-secondary pt-2">Notes</label>
            <textarea
              className="input min-h-[80px]"
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
