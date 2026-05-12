import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ROLES } from '../config'
import PropertySwitcher from './PropertySwitcher'

export default function Header() {
  const { user, logout } = useAuth()
  const roleLabel = ROLES.find((r) => r.id === user?.role)?.label || user?.role || ''

  return (
    <header className="border-b border-ink-700 bg-ink-900/80 backdrop-blur sticky top-0 z-30">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
        <Link to="/app" className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-accent-teal flex items-center justify-center font-display text-lg font-semibold flex-shrink-0">A</div>
          <div className="hidden sm:block">
            <div className="font-display font-semibold leading-none">AVR Hospitality</div>
            <div className="tag">Operations</div>
          </div>
        </Link>
        <div className="flex-1 flex justify-center">
          <PropertySwitcher />
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-sm leading-none">{user?.name || user?.email}</div>
            <div className="tag">{roleLabel}</div>
          </div>
          <button onClick={logout} className="btn-secondary text-sm px-3 py-1.5 min-h-0" title="Sign out">
            <span className="hidden sm:inline">Sign out</span>
            <span className="sm:hidden">⏏</span>
          </button>
        </div>
      </div>
    </header>
  )
}
