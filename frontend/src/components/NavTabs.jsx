import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useProperty } from '../hooks/useProperty'
import { DINNER_ENABLED_PROPERTIES, ROLES } from '../config'

const ALL_TABS = [
  { id: 'overview',     to: '/app',              label: 'Overview' },
  { id: 'shifts',       to: '/app/shifts',       label: 'Shift Checklist' },
  { id: 'inventory',    to: '/app/inventory',    label: 'Inventory' },
  { id: 'rooms',        to: '/app/rooms',        label: 'Rooms' },
  { id: 'housekeeping', to: '/app/housekeeping', label: 'Housekeeping' },
  { id: 'dinner',       to: '/app/dinner',       label: 'Dinner Orders' },
  { id: 'admin',        to: '/app/admin',        label: 'Admin' },
]

export default function NavTabs() {
  const { user } = useAuth()
  const { propertyId } = useProperty()
  const roleConfig = ROLES.find((r) => r.id === user?.role)
  const allowedIds = new Set(roleConfig?.tabs || [])
  const tabs = ALL_TABS.filter((t) => {
    if (!allowedIds.has(t.id)) return false
    if (t.id === 'dinner' && !DINNER_ENABLED_PROPERTIES.has(propertyId)) return false
    return true
  })

  return (
    <nav className="bg-white border-b border-line-subtle sticky top-[57px] z-20">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {tabs.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.to}
              end={tab.to === '/app'}
              className={({ isActive }) =>
                `px-3 sm:px-4 py-3.5 text-[14px] font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
                  isActive
                    ? 'border-brand text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink'
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
