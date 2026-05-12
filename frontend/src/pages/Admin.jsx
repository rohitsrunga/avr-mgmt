import { useEffect, useState } from 'react'
import Banner from '../components/Banner'
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
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold flex-1">Users</h1>
        <button onClick={() => setShowCreate((s) => !s)} className="btn-primary text-sm">
          {showCreate ? 'Cancel' : '+ Create user'}
        </button>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {resetResult && (
        <Banner tone="success">
          New temp password for <strong>{resetResult.username}</strong>: <code className="font-mono bg-ink-900 px-2 py-0.5 rounded">{resetResult.password}</code>
          <button onClick={() => setResetResult(null)} className="ml-3 underline text-xs">Dismiss</button>
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
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-text-secondary text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">Property</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700">
            {users.map((u) => (
              <tr key={u.username}>
                <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                <td className="px-3 py-2">{u.name || '—'}</td>
                <td className="px-3 py-2">
                  <select
                    value={u.role}
                    onChange={(e) => updateUser(u.username, { role: e.target.value })}
                    className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-xs"
                  >
                    {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={u.property || 'both'}
                    onChange={(e) => updateUser(u.username, { property: e.target.value })}
                    className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-xs"
                  >
                    {PROPERTIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={`badge ${u.enabled ? 'bg-accent-teal/20 text-accent-teal' : 'bg-accent-red/20 text-accent-red'}`}>
                    {u.enabled ? u.status : 'disabled'}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-right space-x-2">
                  <button onClick={() => updateUser(u.username, { enabled: !u.enabled })} className="text-xs text-text-secondary hover:text-text-primary">
                    {u.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => resetPassword(u.username)} className="text-xs text-accent-amber hover:underline">
                    Reset pw
                  </button>
                  <button onClick={() => deleteUser(u.username)} className="text-xs text-accent-red hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    <form onSubmit={submit} className="card border-accent-teal/40 space-y-3">
      <h3 className="font-display text-base font-semibold">Create user</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label">Email</label><input className="input" type="email" required value={form.email} onChange={set('email')} /></div>
        <div><label className="label">Name</label><input className="input" value={form.name} onChange={set('name')} /></div>
        <div><label className="label">Role</label>
          <select className="input" value={form.role} onChange={set('role')}>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div><label className="label">Property</label>
          <select className="input" value={form.property} onChange={set('property')}>
            {PROPERTIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
      </div>
      {err && <div className="text-accent-red text-sm">{err}</div>}
    </form>
  )
}
