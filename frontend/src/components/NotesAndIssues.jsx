import { useEffect, useMemo, useState } from 'react'
import Banner from './Banner'
import SectionCard from './SectionCard'
import { useApi } from '../hooks/useApi'

// A quick free-text notepad shared between the Front Desk and Housekeeping
// dashboards, persisted via the housekeeping shared-notes endpoint.
//
// The pad is one newline-delimited blob; each line the API writes is prefixed
// with "<ISO timestamp>\t". Lines written before that format existed have no
// prefix — they're shown under "Earlier" instead of being dated by guesswork.

const WINDOW_DAYS = 30
const DAY_MS = 86400000

function parseLine(raw, index) {
  const tab = raw.indexOf('\t')
  if (tab > 0) {
    const when = new Date(raw.slice(0, tab))
    if (!Number.isNaN(when.getTime())) {
      return { index, raw, at: when, text: raw.slice(tab + 1) }
    }
  }
  return { index, raw, at: null, text: raw }
}

// Local midnight, so a note lands on the day the staffer actually wrote it.
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(d) {
  const today = new Date()
  const diff = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()) -
     new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY_MS,
  )
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function NotesAndIssues({ propertyId, className = '' }) {
  const api = useApi()

  const [notes, setNotes] = useState('')
  const [meta, setMeta] = useState({ updated_at: '', updated_by: '' })
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.get(`/api/housekeeping/${propertyId}/shared-notes`)
      .then((res) => {
        if (cancelled) return
        setNotes(res?.notes || '')
        setMeta({ updated_at: res?.updated_at || '', updated_by: res?.updated_by || '' })
      })
      .catch(() => { /* leave empty if it can't load */ })
    return () => { cancelled = true }
  }, [propertyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Raw storage lines, index-aligned with the blob so a delete can rewrite it.
  const lines = useMemo(
    () => (notes ? notes.split('\n').filter((l) => l.trim() !== '') : []),
    [notes],
  )

  // Newest day first, newest note first within each day. Anything older than
  // the window drops out; undated legacy lines collect in a trailing group.
  const groups = useMemo(() => {
    const cutoff = Date.now() - WINDOW_DAYS * DAY_MS
    const byDay = new Map()
    const undated = []
    lines.map(parseLine).forEach((n) => {
      if (!n.at) { undated.push(n); return }
      if (n.at.getTime() < cutoff) return
      const key = dayKey(n.at)
      if (!byDay.has(key)) byDay.set(key, { key, label: dayLabel(n.at), items: [] })
      byDay.get(key).items.push(n)
    })
    const dated = Array.from(byDay.values())
      .sort((a, b) => (a.key < b.key ? 1 : -1))
      .map((g) => ({ ...g, items: g.items.slice().reverse() }))
    if (undated.length) dated.push({ key: 'earlier', label: 'Earlier', items: undated.slice().reverse() })
    return dated
  }, [lines])

  const shown = groups.reduce((n, g) => n + g.items.length, 0)
  const hidden = lines.length - shown

  async function addNote() {
    const t = draft.trim()
    if (!t) return
    setSaving(true); setError('')
    try {
      const res = await api.post(`/api/housekeeping/${propertyId}/shared-notes`, { note: t })
      setDraft('')
      setNotes(res?.notes || '')
      setMeta({ updated_at: res?.updated_at || '', updated_by: res?.updated_by || '' })
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function removeNote(index) {
    setSaving(true); setError('')
    const nextNotes = lines.filter((_, i) => i !== index).join('\n')
    try {
      const res = await api.put(`/api/housekeeping/${propertyId}/shared-notes`, { notes: nextNotes })
      setNotes(res?.notes ?? nextNotes)
      setMeta({ updated_at: res?.updated_at || '', updated_by: res?.updated_by || '' })
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <SectionCard
      title="Notes"
      className={`w-full min-w-0 lg:h-full flex flex-col min-h-0 ${className}`}
    >
      {error && <Banner tone="error">{error}</Banner>}

      {/* small input field at the top */}
      <div className="flex items-center gap-2">
        <input
          className="input"
          placeholder="Add a note…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNote() } }}
        />
        <button
          onClick={addNote}
          disabled={saving || !draft.trim()}
          className="btn-primary text-[13px] min-h-0 py-2 shrink-0 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {/* Bounded and scrollable — a busy property fills this fast. */}
      <div className="mt-3 space-y-4 max-h-[340px] overflow-y-auto pr-1 min-h-0">
        {groups.length === 0 ? (
          <div className="text-[13px] text-ink-muted">No notes in the last {WINDOW_DAYS} days.</div>
        ) : groups.map((g) => (
          <div key={g.key}>
            <div className="text-[11px] uppercase tracking-[0.06em] text-ink-faint mb-1.5 sticky top-0 bg-white py-0.5">
              {g.label}
            </div>
            <div className="space-y-1.5">
              {g.items.map((n) => (
                <div key={n.index} className="group flex items-start gap-2 text-[14px] text-ink-body">
                  <span className="text-ink-muted leading-6">•</span>
                  <span className="flex-1 whitespace-pre-wrap break-words">{n.text}</span>
                  <button
                    onClick={() => removeNote(n.index)}
                    className="text-ink-muted hover:text-danger text-[14px] leading-6 opacity-0 group-hover:opacity-100 shrink-0"
                    title="Remove note"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {hidden > 0 && (
        <div className="text-[11px] text-ink-faint mt-2">
          {hidden} note{hidden === 1 ? '' : 's'} older than {WINDOW_DAYS} days hidden
        </div>
      )}
      {meta.updated_at && (
        <div className="text-[11px] text-ink-muted mt-2">
          Updated {new Date(meta.updated_at).toLocaleString()}{meta.updated_by ? ` · ${meta.updated_by}` : ''}
        </div>
      )}
    </SectionCard>
  )
}
