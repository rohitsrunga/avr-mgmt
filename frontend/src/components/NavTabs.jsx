import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ROLES } from '../config'

const ALL_TABS = [
  { id: 'overview', to: '/app', label: 'Overview' },
  { id: 'shifts', to: '/app/shifts', label: 'Shifts' },
  { id: 'inventory', to: '/app/inventory', label: 'Inventory' },
  { id: 'checklists', to: '/app/checklists', label: 'Checklists' },
  { id: 'rooms', to: '/app/rooms', label: 'Rooms' },
  { id: 'parkfly', to: '/app/parkfly', label: 'Park & Fly' },
  { id: 'linen', to: '/app/linen', label: 'Linen' },
  { id: 'reports', to: '/app/reports', label: 'Reports' },
  { id: 'admin', to: '/app/admin', label: 'Admin' },
]

export default function NavTabs() {
  const { user } = useAuth()
  const roleConfig = ROLES.find((r) => r.id === user?.role)
  const allowedIds = new Set(roleConfig?.tabs || [])
  const tabs = ALL_TABS.filter((t) => allowedIds.has(t.id))

  return (
    <nav className="border-b border-ink-700 bg-ink-900 overflow-x-auto">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex gap-1 min-w-max">
          {tabs.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.to}
              end={tab.to === '/app'}
              className={({ isActive }) =>
                `px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? 'border-accent-teal text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
