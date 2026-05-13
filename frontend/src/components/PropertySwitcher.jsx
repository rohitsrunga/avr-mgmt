import { useProperty } from '../hooks/useProperty'

export default function PropertySwitcher() {
  const { propertyId, allowedProperties, changeProperty } = useProperty()
  if (allowedProperties.length === 0) return null
  if (allowedProperties.length === 1) {
    return (
      <div className="text-[14px] font-medium text-ink tracking-tightish">
        {allowedProperties[0].short}
      </div>
    )
  }
  return (
    <div className="inline-flex bg-surface-muted border border-line-subtle rounded-lg p-0.5">
      {allowedProperties.map((p) => {
        const active = p.id === propertyId
        return (
          <button
            key={p.id}
            onClick={() => changeProperty(p.id)}
            className={`px-3 py-1.5 text-[13px] rounded-md transition-all ${
              active
                ? 'bg-white text-ink shadow-sm font-medium'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {p.short}
          </button>
        )
      })}
    </div>
  )
}
