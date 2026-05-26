import { useEffect, useState } from 'react'
import Banner from '../components/Banner'
import EmployeeAdmin from '../components/EmployeeAdmin'
import SectionCard from '../components/SectionCard'
import { FEATURE_LABELS, PROPERTIES as APP_PROPERTIES, ROLES } from '../config'
import { useApi } from '../hooks/useApi'
import { useFeatureConfig } from '../hooks/useFeatureConfig'
import { useProperty } from '../hooks/useProperty'

const PROPERTIES = ['casco_bay', 'saco_bay', 'both']
const PROPERTY_LABEL = Object.fromEntries(APP_PROPERTIES.map((p) => [p.id, p.short]))

export default function Admin() {
  const api = useApi()
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [resetResult, setResetResult] = useState(null)

  async function load() {
    try {
      setError('')
      const res = await api.get('/api/admin/users')
      setUsers(res.users || [])
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => { load() }, [])

  async function updateUser(username, patch) {
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(username)}`, patch)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function deleteUser(username) {
    if (!confirm(`Delete user ${username}? This cannot be undone.`)) return
    try {
      await api.del(`/api/admin/users/${encodeURIComponent(username)}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function resetPassword(username) {
    if (!confirm(`Reset password for ${username}? You'll receive a new temporary password to share.`)) return
    try {
      const res = await api.post(`/api/admin/users/${encodeURIComponent(username)}/reset-password`, {})
      setResetResult({ username, password: res.new_password })
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">Owner-only user management.</p>
        </div>
        <button onClick={() => setShowCreate((s) => !s)} className="btn-primary">
          {showCreate ? 'Cancel' : 'Create user'}
        </button>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {resetResult && (
        <Banner tone="success">
          New temp password for <strong>{resetResult.username}</strong>: <code className="font-mono bg-white px-2 py-0.5 rounded border border-line-subtle">{resetResult.password}</code>
          <button onClick={() => setResetResult(null)} className="ml-3 underline text-[13px]">Dismiss</button>
        </Banner>
      )}

      {showCreate && (
        <CreateUserForm
          onCreated={(creds) => {
            setShowCreate(false)
            load()
            setResetResult(creds)
          }}
        />
      )}

      <div className="card p-0 overflow-x-auto">
        <table className="table-clean">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Property</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username}>
                <td className="font-mono text-[12px] text-ink">{u.email}</td>
                <td className="text-ink">{u.name || '—'}</td>
                <td>
                  <select
                    value={u.role}
                    onChange={(e) => updateUser(u.username, { role: e.target.value })}
                    className="select min-h-0 py-1.5 text-[13px]"
                  >
                    {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </td>
                <td>
                  <select
                    value={u.property || 'both'}
                    onChange={(e) => updateUser(u.username, { property: e.target.value })}
                    className="select min-h-0 py-1.5 text-[13px]"
                  >
                    {PROPERTIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td>
                  <span className={u.enabled ? 'badge-positive' : 'badge-danger'}>
                    {u.enabled ? u.status : 'disabled'}
                  </span>
                </td>
                <td className="whitespace-nowrap text-right space-x-3">
                  <button onClick={() => updateUser(u.username, { enabled: !u.enabled })} className="text-[13px] text-ink-body hover:text-ink">
                    {u.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => resetPassword(u.username)} className="text-[13px] text-warning hover:underline">
                    Reset pw
                  </button>
                  <button onClick={() => deleteUser(u.username)} className="text-[13px] text-danger hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <hr className="border-line-subtle my-6" />
      <FeatureToggles />

      <hr className="border-line-subtle my-6" />
      <RosterManager />

      <hr className="border-line-subtle my-6" />
      <EmployeeAdmin />
    </div>
  )
}

function RosterManager() {
  const { propertyId, property } = useProperty()
  return (
    <SectionCard
      title="Rosters"
      subtitle={`Housekeeper + inspector names for ${property?.short || propertyId}. Use the property switcher in the header to manage the other hotel.`}
    >
      <div className="grid md:grid-cols-2 gap-5">
        <RosterPanel
          key={`hk-${propertyId}`}
          title="Housekeepers"
          listPath={`/api/housekeeping/${propertyId}/roster`}
          listKey="roster"
          idKey="housekeeper_id"
          itemPath={(id) => `/api/housekeeping/${propertyId}/roster/${id}`}
          listQuery={null}
        />
        <RosterPanel
          key={`insp-${propertyId}`}
          title="Inspectors"
          listPath={`/api/inspections/${propertyId}/inspectors`}
          listKey="inspectors"
          idKey="inspector_id"
          itemPath={(id) => `/api/inspections/${propertyId}/inspectors/${id}`}
          listQuery={{ include_inactive: 'true' }}
        />
      </div>
    </SectionCard>
  )
}

function RosterPanel({ title, listPath, listKey, idKey, itemPath, listQuery }) {
  const api = useApi()
  const [list, setList] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setError('')
      const res = await api.get(listPath, listQuery || undefined)
      setList(res[listKey] || [])
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [listPath])

  async function add(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true); setError('')
    try {
      await api.post(listPath, { name: name.trim() })
      setName('')
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function toggle(item) {
    setBusy(true); setError('')
    try {
      await api.put(itemPath(item[idKey]), { active: !item.active })
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function remove(item) {
    if (!confirm(`Remove ${item.name}?`)) return
    setBusy(true); setError('')
    try {
      await api.del(itemPath(item[idKey]))
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const active = list.filter((x) => x.active).length
  return (
    <div className="border border-line-subtle rounded-lg p-4 bg-surface-subtle">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        <span className="text-[11px] text-ink-muted tabular-nums">{active} active · {list.length - active} inactive</span>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      <form onSubmit={add} className="flex gap-2 mb-3">
        <input
          className="input min-h-0 py-1.5 text-[13px]"
          placeholder={`Add ${title.toLowerCase().slice(0, -1)} name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn-primary text-[13px] min-h-0 py-1.5 px-3" disabled={busy || !name.trim()}>Add</button>
      </form>
      {list.length === 0 ? (
        <div className="text-[13px] text-ink-muted py-4 text-center">No one on the roster yet.</div>
      ) : (
        <ul className="divide-y divide-line-subtle bg-white border border-line-subtle rounded-md">
          {list.map((item) => (
            <li key={item[idKey]} className="flex items-center gap-2 px-3 py-2">
              <span className={`flex-1 text-[14px] ${item.active ? 'text-ink' : 'text-ink-muted line-through'}`}>{item.name}</span>
              <button
                onClick={() => toggle(item)}
                disabled={busy}
                className={`text-[11px] font-semibold px-2 py-1 rounded ${item.active ? 'text-ink-body hover:text-ink' : 'text-brand'}`}
              >
                {item.active ? 'Disable' : 'Enable'}
              </button>
              <button onClick={() => remove(item)} disabled={busy} className="text-ink-muted hover:text-danger text-[16px] leading-none px-1">×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FeatureToggles() {
  const { properties, features, config, setEnabled, reload, error: configError } = useFeatureConfig()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => { setError(configError || '') }, [configError])

  async function toggle(propertyId, featureId) {
    const current = new Set(config[propertyId] || [])
    if (current.has(featureId)) current.delete(featureId)
    else current.add(featureId)
    setBusy(`${propertyId}#${featureId}`)
    setError('')
    try {
      await setEnabled(propertyId, Array.from(current))
      setSaved(`${propertyId}#${featureId}`)
      setTimeout(() => setSaved(''), 1200)
    } catch (e) {
      setError(e.message)
      reload()
    } finally {
      setBusy('')
    }
  }

  return (
    <SectionCard
      title="Property features"
      subtitle="Owner-only. Toggle which sections are visible for each property. Changes take effect after the next page load."
    >
      {error && <Banner tone="error">{error}</Banner>}
      <div className="overflow-x-auto">
        <table className="table-clean">
          <thead>
            <tr>
              <th>Feature</th>
              {properties.map((pid) => (
                <th key={pid} className="text-center w-36">{PROPERTY_LABEL[pid] || pid}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((fid) => (
              <tr key={fid}>
                <td className="text-ink">{FEATURE_LABELS[fid] || fid}</td>
                {properties.map((pid) => {
                  const enabled = (config[pid] || []).includes(fid)
                  const isBusy = busy === `${pid}#${fid}`
                  const justSaved = saved === `${pid}#${fid}`
                  return (
                    <td key={pid} className="text-center">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => toggle(pid, fid)}
                        title={enabled ? 'Disable' : 'Enable'}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          enabled ? 'bg-brand' : 'bg-surface-sunken'
                        } ${isBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-card transition-transform ${
                            enabled ? 'translate-x-5' : 'translate-x-0.5'
                          }`}
                        />
                        {justSaved && (
                          <span className="absolute -right-7 top-1/2 -translate-y-1/2 text-[11px] text-positive">Saved</span>
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-ink-muted mt-3">
        Disabling a feature hides the tab and rejects submissions to that property's public form. Defaults: every feature enabled in every property.
      </p>
    </SectionCard>
  )
}

function CreateUserForm({ onCreated }) {
  const api = useApi()
  const [form, setForm] = useState({ email: '', name: '', role: 'frontdesk', property: 'casco_bay' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })) }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const res = await api.post('/api/admin/users', form)
      onCreated?.({ username: res.username, password: res.temp_password })
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="card bg-surface-subtle space-y-4">
      <h3 className="section-title">Create user</h3>
      <div className="grid sm:grid-cols-2 gap-4">
        <div><label className="label">Email</label><input className="input" type="email" required value={form.email} onChange={set('email')} /></div>
        <div><label className="label">Name</label><input className="input" value={form.name} onChange={set('name')} /></div>
        <div><label className="label">Role</label>
          <select className="select" value={form.role} onChange={set('role')}>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div><label className="label">Property</label>
          <select className="select" value={form.property} onChange={set('property')}>
            {PROPERTIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
      </div>
      {err && <div className="text-danger text-[14px]">{err}</div>}
    </form>
  )
}
