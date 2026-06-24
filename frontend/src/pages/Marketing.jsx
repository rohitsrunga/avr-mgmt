import { useEffect, useState } from 'react'
import Banner from '../components/Banner'
import CopyLink from '../components/CopyLink'
import FinanceReconciliation from '../components/FinanceReconciliation'
import FinancePnL from '../components/FinancePnL'
import PaymentCalendar from '../components/PaymentCalendar'
import SectionCard from '../components/SectionCard'
import {
  CONFIG,
  GROUP_ROOM_TYPES,
  GROUP_STATUSES,
} from '../config'
import { useAuth } from '../auth/AuthProvider'
import { useApi } from '../hooks/useApi'
import { useFeatureConfig } from '../hooks/useFeatureConfig'
import { useProperty } from '../hooks/useProperty'

const STATUS_MAP = Object.fromEntries(GROUP_STATUSES.map((s) => [s.id, s]))

export default function Marketing() {
  const api = useApi()
  const { user } = useAuth()
  const { propertyId, property } = useProperty()
  const { isEnabled } = useFeatureConfig()
  const groupsOn = isEnabled('groups', propertyId)
  const isManagement = ['owner', 'manager'].includes(user?.role)
  const pnlOn = isManagement && isEnabled('finance_pnl', propertyId)
  // Reconciliation is Cloudbeds-backed — Saco Bay only.
  const reconOn = isManagement && propertyId === 'saco_bay'
  // All-Hotels consolidation needs P&L enabled on both properties.
  const pnlBoth = isManagement && isEnabled('finance_pnl', 'casco_bay') && isEnabled('finance_pnl', 'saco_bay')
  const [financeScope, setFinanceScope] = useState('property') // 'property' | 'all'
  const consolidated = financeScope === 'all' && pnlBoth
  // `all`: view supports the All-Hotels scope (reconciliation is per-hotel only).
  const financeViews = [
    ...(pnlOn ? [{ id: 'pnl', label: 'Budget Estimation', all: true }] : []),
    ...(pnlOn ? [{ id: 'payment-calendar', label: 'Payment Calendar', all: true }] : []),
    ...(reconOn ? [{ id: 'reconciliation', label: 'Reconciliation', all: false }] : []),
  ]
  const availableViews = consolidated ? financeViews.filter((v) => v.all) : financeViews
  const [financeView, setFinanceView] = useState('pnl')
  const activeFinanceView = availableViews.some((v) => v.id === financeView)
    ? financeView
    : availableViews[0]?.id

  const [contracts, setContracts] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState(null) // contract detail (with activity_log)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    if (!groupsOn) { setContracts([]); return }
    try {
      setError('')
      const list = await api.get(`/api/groups/${propertyId}`, { status: statusFilter || undefined })
      setContracts(list.contracts || [])
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyId, statusFilter, groupsOn])

  async function openContract(c) {
    try {
      const res = await api.get(`/api/groups/${propertyId}/${c.contract_id}`)
      setSelected(res.contract)
    } catch (e) { setError(e.message) }
  }

  const inquiryUrl = groupsOn && CONFIG.publicFormsBaseUrl ? `${CONFIG.publicFormsBaseUrl}/groups.html?p=${propertyId}` : ''

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="page-title">Finance &amp; Marketing</h1>
          <p className="page-subtitle">{property?.name} · payout reconciliation, group contracts, and outreach pace.</p>
        </div>
        {groupsOn && <button onClick={() => setCreating(true)} className="btn-primary">+ New contract</button>}
      </div>

      {financeViews.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[16px] font-semibold text-ink tracking-tight">Finance</h2>
            {pnlBoth && (
              <div className="inline-flex rounded-full bg-surface-muted p-0.5">
                {[{ id: 'property', label: property?.short || 'This hotel' }, { id: 'all', label: 'All Hotels' }].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setFinanceScope(s.id)}
                    className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition ${
                      financeScope === s.id ? 'bg-white text-ink shadow-sm' : 'text-ink-muted'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            {availableViews.length > 1 && (
              <div className="inline-flex rounded-full bg-surface-muted p-0.5">
                {availableViews.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setFinanceView(v.id)}
                    className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition ${
                      activeFinanceView === v.id ? 'bg-white text-ink shadow-sm' : 'text-ink-muted'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {activeFinanceView === 'pnl' && (
            <FinancePnL propertyIds={consolidated ? ['casco_bay', 'saco_bay'] : [propertyId]} consolidated={consolidated} />
          )}
          {activeFinanceView === 'payment-calendar' && (
            <PaymentCalendar propertyId={consolidated ? 'all_hotels' : propertyId} />
          )}
          {activeFinanceView === 'reconciliation' && (
            <FinanceReconciliation propertyId={propertyId} />
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-[16px] font-semibold text-ink tracking-tight">Marketing</h2>

        {inquiryUrl && <CopyLink url={inquiryUrl} label="Public group-inquiry form" />}

        {error && <Banner tone="error">{error}</Banner>}

        <div className={selected ? 'grid lg:grid-cols-3 gap-5' : ''}>
        <div className={selected ? 'lg:col-span-2 space-y-4' : 'space-y-4'}>
          {groupsOn && (
            <SectionCard
              title={`All contracts · ${contracts.length}`}
              actions={
                <select className="select min-h-0 py-1.5 text-[13px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  {GROUP_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              }
            >
              {contracts.length === 0 ? (
                <div className="text-[14px] text-ink-muted py-10 text-center">No contracts match.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-clean text-[13px]">
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Contact</th>
                        <th className="w-24">Arrive</th>
                        <th className="w-16">Nights</th>
                        <th className="w-20">Rooms</th>
                        <th className="w-20">Rate</th>
                        <th className="w-32">Status</th>
                        <th className="w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {contracts.map((c) => {
                        const status = STATUS_MAP[c.status] || GROUP_STATUSES[0]
                        const nights = c.check_in_date && c.check_out_date
                          ? Math.max(0, Math.round((new Date(c.check_out_date) - new Date(c.check_in_date)) / 86400000))
                          : '—'
                        return (
                          <tr key={c.contract_id} onClick={() => openContract(c)} className="cursor-pointer">
                            <td>
                              <div className="text-ink font-medium">{c.group_name}</div>
                              {c.cutoff_date && (
                                <div className={`text-[10px] ${c.cutoff_alert ? 'text-danger' : 'text-ink-muted'}`}>cutoff {c.cutoff_date}</div>
                              )}
                            </td>
                            <td className="text-ink-body">{c.contact_name}</td>
                            <td className="tabular-nums">{c.check_in_date || '—'}</td>
                            <td className="tabular-nums">{nights}</td>
                            <td className="tabular-nums">{c.room_count} {c.room_type}</td>
                            <td className="tabular-nums">{c.room_rate != null ? `$${Number(c.room_rate).toFixed(0)}` : '—'}</td>
                            <td><span className={`badge-${status.tone}`}>{status.label}</span></td>
                            <td className="text-right text-ink-muted">›</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          )}
        </div>

        {selected && (
          <div className="space-y-4">
            <SectionCard title="Recent activity" actions={<span className="text-[11px] text-ink-muted truncate">{selected.group_name}</span>}>
              {(selected.activity_log || []).length === 0 ? (
                <div className="text-[13px] text-ink-muted py-4 text-center">No activity yet.</div>
              ) : (
                <div className="space-y-2.5 text-[12px]">
                  {selected.activity_log.slice().reverse().slice(0, 8).map((l) => (
                    <div key={l.log_id || l.created_at} className="border-l-2 border-line-subtle pl-3 py-0.5">
                      <div className="font-medium text-ink">{l.note}</div>
                      <div className="text-[10px] text-ink-muted">{l.author || '—'} · {l.created_at ? new Date(l.created_at).toLocaleString() : ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}
        </div>
      </section>

      {creating && groupsOn && (
        <ContractFormModal propertyId={propertyId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />
      )}
      {selected && (
        <ContractDetailModal
          contract={selected}
          propertyId={propertyId}
          onClose={() => setSelected(null)}
          onSaved={(updated) => { if (updated) setSelected(updated); load() }}
        />
      )}
    </div>
  )
}

function ContractFormModal({ propertyId, onClose, onSaved }) {
  const api = useApi()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    group_name: '', contact_name: '', contact_phone: '', contact_email: '',
    company_address: '',
    check_in_date: today, check_out_date: today,
    room_count: 10, room_type: 'standard',
    room_rate: '', triple_rate: '', quad_rate: '',
    deposit_by_date: '', cutoff_date: '', special_notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })) }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await api.post(`/api/groups/${propertyId}`, { ...form, source: 'manual' })
      onSaved?.()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title="New group contract">
      <form onSubmit={submit} className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Group name"><input className="input" required value={form.group_name} onChange={set('group_name')} /></Field>
          <Field label="Contact name"><input className="input" required value={form.contact_name} onChange={set('contact_name')} /></Field>
          <Field label="Phone"><input className="input" required value={form.contact_phone} onChange={set('contact_phone')} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.contact_email} onChange={set('contact_email')} /></Field>
          <Field label="Check-in"><input type="date" className="input" required value={form.check_in_date} onChange={set('check_in_date')} /></Field>
          <Field label="Check-out"><input type="date" className="input" required value={form.check_out_date} onChange={set('check_out_date')} /></Field>
          <Field label="Room count"><input type="number" min="1" className="input" required value={form.room_count} onChange={set('room_count')} /></Field>
          <Field label="Room type">
            <select className="select" value={form.room_type} onChange={set('room_type')}>
              {GROUP_ROOM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Standard rate"><input type="number" step="0.01" className="input" value={form.room_rate} onChange={set('room_rate')} /></Field>
          <Field label="Triple rate"><input type="number" step="0.01" className="input" value={form.triple_rate} onChange={set('triple_rate')} /></Field>
          <Field label="Quad rate"><input type="number" step="0.01" className="input" value={form.quad_rate} onChange={set('quad_rate')} /></Field>
          <Field label="Deposit by"><input type="date" className="input" value={form.deposit_by_date} onChange={set('deposit_by_date')} /></Field>
          <Field label="Cutoff date"><input type="date" className="input" value={form.cutoff_date} onChange={set('cutoff_date')} /></Field>
          <Field label="Company address" className="sm:col-span-2"><input className="input" value={form.company_address} onChange={set('company_address')} /></Field>
          <Field label="Special notes" className="sm:col-span-2"><textarea className="textarea" rows={3} value={form.special_notes} onChange={set('special_notes')} /></Field>
        </div>
        <div className="flex gap-2 justify-end pt-3 border-t border-line-subtle">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  )
}

function ContractDetailModal({ contract, propertyId, onClose, onSaved }) {
  const api = useApi()
  const [c, setC] = useState(contract)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setC(contract) }, [contract?.contract_id])

  async function update(patch) {
    setBusy(true); setError('')
    try {
      const res = await api.put(`/api/groups/${propertyId}/${c.contract_id}`, patch)
      const next = { ...c, ...res.contract, activity_log: c.activity_log }
      setC(next); onSaved?.(next)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function addNote(e) {
    e.preventDefault()
    if (note.trim().length < 5) return
    setBusy(true); setError('')
    try {
      const res = await api.post(`/api/groups/${propertyId}/${c.contract_id}/notes`, { note: note.trim() })
      const next = { ...c, activity_log: [...(c.activity_log || []), res.log] }
      setC(next); onSaved?.(next)
      setNote('')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function remove() {
    if (!confirm(`Delete contract for "${c.group_name}"?`)) return
    setBusy(true); setError('')
    try {
      await api.del(`/api/groups/${propertyId}/${c.contract_id}`)
      onSaved?.(null); onClose()
    } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title={c.group_name} subtitle={`${c.check_in_date} → ${c.check_out_date}`}>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-3 text-[14px]">
          <Detail label="Contact" value={`${c.contact_name} · ${c.contact_phone}${c.contact_email ? ' · ' + c.contact_email : ''}`} />
          <Detail label="Rooms" value={`${c.room_count} (${c.room_type})`} />
          <Detail label="Standard rate" value={c.room_rate != null ? `$${Number(c.room_rate).toFixed(2)}` : '—'} />
          <Detail label="Triple / Quad" value={[c.triple_rate, c.quad_rate].map((r) => r != null ? `$${Number(r).toFixed(2)}` : '—').join(' / ')} />
          <Detail label="Cutoff" value={c.cutoff_date || '—'} tone={c.cutoff_alert ? 'danger' : 'neutral'} />
          <Detail label="Deposit by" value={c.deposit_by_date || '—'} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[12px] uppercase tracking-[0.06em] text-ink-muted mr-2">Status</div>
          {GROUP_STATUSES.map((s) => (
            <button key={s.id} disabled={busy || c.status === s.id} onClick={() => update({ status: s.id })}
              className={`px-3 py-1.5 rounded-full text-[13px] font-medium ${c.status === s.id ? `badge-${s.tone}` : 'bg-white border border-line text-ink-body hover:border-ink-muted'}`}>
              {s.label}
            </button>
          ))}
          <button disabled={busy} onClick={() => update({ deposit_paid: !c.deposit_paid })}
            className={`ml-auto px-3 py-1.5 rounded-full text-[13px] font-medium ${c.deposit_paid ? 'badge-positive' : 'bg-white border border-line text-ink-body'}`}>
            {c.deposit_paid ? 'Deposit paid' : 'Mark deposit paid'}
          </button>
        </div>

        {c.special_notes && (
          <div className="bg-warning-tint border border-warning/20 rounded-lg px-4 py-3 text-[14px] text-ink-body">
            <strong className="block text-warning mb-1 text-[12px] uppercase tracking-[0.06em]">Special notes</strong>
            {c.special_notes}
          </div>
        )}

        <div>
          <h3 className="section-title mb-3">Activity log</h3>
          <ul className="space-y-2 mb-3 max-h-48 overflow-y-auto pr-2">
            {(c.activity_log || []).length === 0 ? (
              <li className="text-[13px] text-ink-muted">No notes yet.</li>
            ) : c.activity_log.map((l) => (
              <li key={l.log_id || l.created_at} className="text-[13px]">
                <div className="text-ink-muted text-[11px]">{new Date(l.created_at).toLocaleString()} · {l.author || '—'}</div>
                <div className="text-ink-body">{l.note}</div>
              </li>
            ))}
          </ul>
          <form onSubmit={addNote} className="flex gap-2">
            <input className="input" placeholder="Activity note (min 5 chars)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn-primary" disabled={busy || note.trim().length < 5}>Add</button>
          </form>
        </div>

        <div className="flex justify-between pt-3 border-t border-line-subtle">
          <button onClick={remove} className="btn-ghost text-danger">Delete</button>
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function Detail({ label, value, tone = 'neutral' }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.06em] text-ink-muted">{label}</div>
      <div className={`text-[14px] ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

function Modal({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-line-subtle">
          <h2 className="section-title">{title}</h2>
          {subtitle && <p className="text-[13px] text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}
