import { useEffect, useState } from 'react'
import Banner from '../components/Banner'
import EmployeeAdmin from '../components/EmployeeAdmin'
import { ROLES } from '../config'
import { useApi } from '../hooks/useApi'

const PROPERTIES = ['casco_bay', 'saco_bay', 'both']

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
      <EmployeeAdmin />
    </div>
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
