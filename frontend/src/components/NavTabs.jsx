import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useProperty } from '../hooks/useProperty'
import { ROLES } from '../config'

const ALL_TABS = [
  { id: 'checklists', to: '/app/checklists', label: 'Checklists' },
  { id: 'property',   to: '/app/property',   label: 'Housekeeping & Inspections' },
  { id: 'marketing',  to: '/app/marketing',  label: 'Finance & Marketing' },
  { id: 'inventory',  to: '/app/inventory',  label: 'Inventory' },
  { id: 'admin',      to: '/app/admin',      label: 'Admin' },
]

export default function NavTabs() {
  const { user } = useAuth()
  useProperty()
  const roleConfig = ROLES.find((r) => r.id === user?.role)
  const allowedIds = new Set(roleConfig?.tabs || [])
  const tabs = ALL_TABS.filter((t) => allowedIds.has(t.id))

  return (
    <nav className="bg-white border-b border-line-subtle sticky top-[57px] z-20">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {tabs.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.to}
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
