import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export default function LoginPage() {
  const { login, completeNewPassword, pendingChallenge } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await login(email, password)
      if (result.challenge !== 'NEW_PASSWORD_REQUIRED') {
        navigate('/app', { replace: true })
      }
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  async function onCompleteNewPassword(e) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      await completeNewPassword(newPassword)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err.message || 'Password update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-accent-teal flex items-center justify-center font-display text-xl font-semibold">A</div>
          <div>
            <h1 className="text-xl font-semibold">AVR Management</h1>
            <div className="tag">Hotel operations</div>
          </div>
        </div>
        {!pendingChallenge ? (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            {error && <div className="text-accent-red text-sm">{error}</div>}
            <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        ) : (
          <form onSubmit={onCompleteNewPassword} className="space-y-4">
            <p className="text-text-body text-sm">Set a new password for first-time sign-in.</p>
            <div>
              <label className="label">New password</label>
              <input className="input" type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input className="input" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <div className="text-accent-red text-sm">{error}</div>}
            <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Updating…' : 'Continue'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
