import { useProperty } from '../hooks/useProperty'

export default function PropertySwitcher() {
  const { propertyId, allowedProperties, changeProperty } = useProperty()
  if (allowedProperties.length === 0) return null
  if (allowedProperties.length === 1) {
    return (
      <div className="text-sm font-display font-semibold text-text-primary">
        {allowedProperties[0].short}
      </div>
    )
  }
  return (
    <div className="inline-flex bg-ink-800 border border-ink-700 rounded-lg p-0.5">
      {allowedProperties.map((p) => {
        const active = p.id === propertyId
        const accentClass = active ? (p.accent === 'teal' ? 'bg-accent-teal' : 'bg-accent-amber') : ''
        return (
          <button
            key={p.id}
            onClick={() => changeProperty(p.id)}
            className={`px-3 py-1.5 text-xs sm:text-sm rounded-md transition-colors ${active ? `${accentClass} text-white font-semibold` : 'text-text-secondary hover:text-text-primary'}`}
          >
            {p.short}
          </button>
        )
      })}
    </div>
  )
}
