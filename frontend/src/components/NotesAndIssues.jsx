import { useEffect, useMemo, useState } from 'react'
import Banner from './Banner'
import SectionCard from './SectionCard'
import { useApi } from '../hooks/useApi'

// A quick free-text notepad shared between the Front Desk and Housekeeping
// dashboards, persisted via the housekeeping shared-notes endpoint.
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

  const lines = useMemo(
    () => (notes ? notes.split('\n').filter((l) => l.trim() !== '') : []),
    [notes],
  )

  async function persist(nextNotes) {
    setSaving(true); setError('')
    try {
      const res = await api.put(`/api/housekeeping/${propertyId}/shared-notes`, { notes: nextNotes })
      setNotes(nextNotes)
      setMeta({ updated_at: res?.updated_at || '', updated_by: res?.updated_by || '' })
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  function addNote() {
    const t = draft.trim()
    if (!t) return
    setDraft('')
    persist([...lines, t].join('\n'))
  }

  function removeNote(idx) {
    persist(lines.filter((_, i) => i !== idx).join('\n'))
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

      {/* the actual notes underneath */}
      <div className="mt-3 space-y-1.5">
        {lines.length === 0 ? (
          <div className="text-[13px] text-ink-muted">No notes yet.</div>
        ) : lines.map((line, idx) => (
          <div key={idx} className="group flex items-start gap-2 text-[14px] text-ink-body">
            <span className="text-ink-muted leading-6">•</span>
            <span className="flex-1 whitespace-pre-wrap break-words">{line}</span>
            <button
              onClick={() => removeNote(idx)}
              className="text-ink-muted hover:text-danger text-[14px] leading-6 opacity-0 group-hover:opacity-100 shrink-0"
              title="Remove note"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {meta.updated_at && (
        <div className="text-[11px] text-ink-muted mt-2">
          Updated {new Date(meta.updated_at).toLocaleString()}{meta.updated_by ? ` · ${meta.updated_by}` : ''}
        </div>
      )}
    </SectionCard>
  )
}
