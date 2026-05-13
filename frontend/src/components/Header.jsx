import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ROLES } from '../config'
import PropertySwitcher from './PropertySwitcher'

export default function Header() {
  const { user, logout } = useAuth()
  const roleLabel = ROLES.find((r) => r.id === user?.role)?.label || user?.role || ''

  return (
    <header className="bg-white/85 backdrop-blur border-b border-line-subtle sticky top-0 z-30">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 h-[57px] flex items-center gap-3 sm:gap-4">
        <Link to="/app" className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-ink text-white flex items-center justify-center text-[15px] font-semibold tracking-tight flex-shrink-0">
            A
          </div>
          <div className="hidden sm:block leading-tight">
            <div className="text-[15px] font-semibold tracking-tightish text-ink">AVR Hospitality</div>
            <div className="text-[11px] text-ink-muted">Operations</div>
          </div>
        </Link>
        <div className="flex-1 flex justify-center">
          <PropertySwitcher />
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block leading-tight">
            <div className="text-[13px] text-ink font-medium">{user?.name || user?.email}</div>
            <div className="text-[11px] text-ink-muted">{roleLabel}</div>
          </div>
          <button onClick={logout} className="btn-secondary text-[13px] px-3 py-1.5 min-h-0" title="Sign out">
            <span className="hidden sm:inline">Sign out</span>
            <span className="sm:hidden">⏏</span>
          </button>
        </div>
      </div>
    </header>
  )
}
