import { useEffect, useMemo, useState } from 'react'
import { CONFIG, PROPERTIES } from '../config'
import { useApi } from '../hooks/useApi'
import Banner from './Banner'

const STATUS_BADGES = {
  invited:   { label: 'Invited',   cls: 'badge-brand' },
  opened:    { label: 'Opened',    cls: 'badge-brand' },
  submitted: { label: 'Submitted', cls: 'badge-warning' },
  reviewed:  { label: 'Reviewed',  cls: 'badge-positive' },
  archived:  { label: 'Archived',  cls: 'badge-neutral' },
  expired:   { label: 'Expired',   cls: 'badge-danger' },
}

function inviteUrl(token) {
  if (!CONFIG.publicFormsBaseUrl) return ''
  return `${CONFIG.publicFormsBaseUrl}/onboarding.html?token=${encodeURIComponent(token)}`
}

function handbookUrl(propertyId) {
  if (!CONFIG.publicFormsBaseUrl) return ''
  return `${CONFIG.publicFormsBaseUrl}/handbook.html?p=${encodeURIComponent(propertyId)}`
}

export default function EmployeeAdmin() {
  const api = useApi()
  const [employees, setEmployees] = useState([])
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [invite, setInvite] = useState(null)        // {employee, token, url}
  const [detail, setDetail] = useState(null)        // open detail modal
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      setError('')
      const res = await api.get('/api/admin/employees')
      setEmployees(res.employees || [])
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => { load() }, [])

  async function createEmployee(form) {
    setBusy(true)
    try {
      const res = await api.post('/api/admin/employees', form)
      setShowCreate(false)
      setInvite({
        employee: res.employee,
        token: res.invite_token,
        url: inviteUrl(res.invite_token),
        expires_at: res.token_expires_at,
      })
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function resend(employee) {
    if (!confirm(`Resend invite to ${employee.name}? The previous link will stop working.`)) return
    try {
      const res = await api.post(`/api/admin/employees/${employee.employee_id}/resend`, {})
      setInvite({
        employee: res.employee,
        token: res.invite_token,
        url: inviteUrl(res.invite_token),
        expires_at: res.token_expires_at,
      })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function setStatus(employee, status) {
    try {
      await api.post(`/api/admin/employees/${employee.employee_id}/status`, { status })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function remove(employee) {
    if (!confirm(`Delete employee ${employee.name}? This removes their submitted packet from storage.`)) return
    try {
      await api.del(`/api/admin/employees/${employee.employee_id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function viewFilled(employee) {
    try {
      const res = await api.get(`/api/admin/employees/${employee.employee_id}/filled-url`)
      window.open(res.url, '_blank', 'noopener')
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h2 className="page-title text-[24px]">Employee Admin</h2>
          <p className="page-subtitle">Send onboarding packets and track submissions.</p>
        </div>
        <HandbookShareButton />
        <button onClick={() => setShowCreate((s) => !s)} className="btn-primary">
          {showCreate ? 'Cancel' : 'New employee'}
        </button>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {invite && <InviteShareCard invite={invite} onClose={() => setInvite(null)} />}

      {showCreate && (
        <CreateEmployeeForm
          busy={busy}
          onSubmit={createEmployee}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <div className="card p-0 overflow-x-auto">
        <table className="table-clean">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Hotel</th>
              <th>Status</th>
              <th>Invited</th>
              <th>Submitted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr><td colSpan={7} className="text-center text-ink-muted py-6">No employees yet.</td></tr>
            )}
            {employees.map((e) => {
              const badge = STATUS_BADGES[e.status] || STATUS_BADGES.invited
              return (
                <tr key={e.employee_id}>
                  <td className="text-ink font-medium">{e.name}</td>
                  <td className="text-ink-body text-[13px]">{e.email}</td>
                  <td className="text-ink-body text-[13px]">{prettyProperty(e.property)}</td>
                  <td><span className={badge.cls}>{badge.label}</span></td>
                  <td className="text-ink-muted text-[12px] font-mono">{shortDate(e.invited_at)}</td>
                  <td className="text-ink-muted text-[12px] font-mono">{shortDate(e.submitted_at)}</td>
                  <td className="whitespace-nowrap text-right space-x-3">
                    <button onClick={() => setDetail(e)} className="text-[13px] text-ink-body hover:text-ink">View</button>
                    {e.has_filled_form && (
                      <button onClick={() => viewFilled(e)} className="text-[13px] text-brand hover:underline">Packet</button>
                    )}
                    {['invited', 'opened', 'expired'].includes(e.status) && (
                      <button onClick={() => resend(e)} className="text-[13px] text-warning hover:underline">Resend</button>
                    )}
                    {e.status === 'submitted' && (
                      <button onClick={() => setStatus(e, 'reviewed')} className="text-[13px] text-positive hover:underline">Mark reviewed</button>
                    )}
                    {e.status !== 'archived' && (
                      <button onClick={() => setStatus(e, 'archived')} className="text-[13px] text-ink-body hover:underline">Archive</button>
                    )}
                    <button onClick={() => remove(e)} className="text-[13px] text-danger hover:underline">Delete</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {detail && (
        <EmployeeDetailModal
          employee={detail}
          api={api}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

function prettyProperty(pid) {
  return PROPERTIES.find((p) => p.id === pid)?.short || pid || '—'
}

function shortDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}

function CreateEmployeeForm({ onSubmit, onCancel, busy }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', property: 'casco_bay' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(form) }}
      className="card bg-surface-subtle space-y-4"
    >
      <h3 className="section-title">New employee</h3>
      <div className="grid sm:grid-cols-2 gap-4">
        <div><label className="label">Full name</label><input className="input" required value={form.name} onChange={set('name')} /></div>
        <div><label className="label">Email</label><input className="input" type="email" required value={form.email} onChange={set('email')} /></div>
        <div><label className="label">Phone</label><input className="input" type="tel" value={form.phone} onChange={set('phone')} /></div>
        <div>
          <label className="label">Hotel</label>
          <select className="select" value={form.property} onChange={set('property')}>
            {PROPERTIES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Create + generate link'}</button>
      </div>
    </form>
  )
}

function InviteShareCard({ invite, onClose }) {
  const [copied, setCopied] = useState(false)
  const url = invite.url || `(set VITE_PUBLIC_FORMS_BASE_URL to enable share link; token: ${invite.token})`
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  const exp = invite.expires_at ? new Date(invite.expires_at).toLocaleString() : ''
  return (
    <div className="card bg-positive-tint border-positive/30 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-ink">Invite ready for {invite.employee?.name}</div>
          <div className="text-[13px] text-ink-body">Share this link by email or text. Expires {exp}.</div>
        </div>
        <button onClick={onClose} className="text-[13px] text-ink-body hover:text-ink">Dismiss</button>
      </div>
      <div className="flex items-center gap-2">
        <input className="input flex-1 font-mono text-[12px]" readOnly value={url} />
        <button className="btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  )
}

function HandbookShareButton() {
  const [open, setOpen] = useState(false)
  const [property, setProperty] = useState('casco_bay')
  const url = handbookUrl(property)
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-secondary">Share handbook</button>
  }
  return (
    <div className="card bg-surface-subtle border-line-subtle p-3 flex items-center gap-3">
      <select className="select min-h-0 py-1.5 text-[13px]" value={property} onChange={(e) => setProperty(e.target.value)}>
        {PROPERTIES.map((p) => <option key={p.id} value={p.id}>{p.short}</option>)}
      </select>
      <input className="input min-h-0 py-1.5 text-[12px] font-mono w-[260px]" readOnly value={url || '(no public-forms URL configured)'} />
      <button className="btn-primary" onClick={copy} disabled={!url}>{copied ? 'Copied' : 'Copy'}</button>
      <button className="text-[13px] text-ink-body hover:text-ink" onClick={() => setOpen(false)}>Close</button>
    </div>
  )
}

function EmployeeDetailModal({ employee, api, onClose }) {
  const [reveal, setReveal] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  async function load(showSecrets) {
    try {
      setError('')
      const q = showSecrets ? '?reveal=1' : ''
      const res = await api.get(`/api/admin/employees/${employee.employee_id}${q}`)
      setData(res.employee)
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => { load(false) }, [employee.employee_id])

  function doReveal() {
    if (!confirm('Reveal SSN and bank account numbers? This action is sensitive.')) return
    setReveal(true)
    load(true)
  }

  const d = data?.submitted_data || {}
  const hasSubmission = !!data?.submitted_at

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line-subtle flex items-center justify-between">
          <div>
            <div className="text-[18px] font-semibold text-ink">{employee.name}</div>
            <div className="text-[13px] text-ink-muted">{employee.email} · {prettyProperty(employee.property)}</div>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <Banner tone="error">{error}</Banner>}
          {!hasSubmission && (
            <Banner tone="info">Employee hasn't submitted their packet yet.</Banner>
          )}
          {hasSubmission && (
            <>
              <div className="flex justify-end">
                {!reveal && <button className="btn-secondary text-[13px]" onClick={doReveal}>Reveal SSN / bank</button>}
                {reveal && <span className="text-[12px] text-warning">SSN / bank revealed</span>}
              </div>
              <DetailSection title="Part 1 — Personal information">
                <DetailRow label="Address" value={d.address} />
                <DetailRow label="Date of birth" value={d.dob} />
                <DetailRow label="SSN" value={d.ssn} mono />
                <DetailRow label="Phone" value={d.phone} />
                <DetailRow label="Date hired" value={d.date_hired} />
                <DetailRow label="Position" value={d.position} />
                <DetailRow label="Pay rate" value={d.pay_rate} />
                <DetailRow label="Status" value={d.status_type} />
                <DetailRow label="Emergency contact" value={`${d.emergency_name || ''} ${d.emergency_relationship ? `(${d.emergency_relationship})` : ''}`.trim()} />
                <DetailRow label="Emergency phone" value={d.emergency_phone} />
              </DetailSection>

              <DetailSection title="Part 2 — Direct deposit &amp; 401(k)">
                <DetailRow label="Bank" value={d.bank_name} />
                <DetailRow label="Account type" value={d.account_type} />
                <DetailRow label="Routing #" value={d.routing_number} mono />
                <DetailRow label="Account #" value={d.account_number} mono />
                <DetailRow label="Deposit status" value={d.deposit_status} />
                <DetailRow label="401(k)" value={d.elect_401k ? 'Participating' : 'Opted out'} />
                {d.elect_401k && (
                  <DetailRow label="Contribution" value={d.contrib_percent ? `${d.contrib_percent}%` : d.contrib_amount ? `$${d.contrib_amount}` : '—'} />
                )}
              </DetailSection>

              <DetailSection title="Part 3 — Acknowledgments">
                {Object.entries(d.ack || {}).map(([k, v]) => (
                  <DetailRow key={k} label={k} value={v ? '✓' : '✗'} />
                ))}
                <DetailRow label="Typed name" value={d.typed_name} />
                <DetailRow label="Date signed" value={d.typed_date} />
              </DetailSection>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailSection({ title, children }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-ink-muted uppercase tracking-wide mb-2" dangerouslySetInnerHTML={{ __html: title }} />
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[14px]">
        {children}
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line-subtle/50 py-1.5">
      <span className="text-ink-muted">{label}</span>
      <span className={`text-ink text-right ${mono ? 'font-mono text-[13px]' : ''}`}>{value || '—'}</span>
    </div>
  )
}
