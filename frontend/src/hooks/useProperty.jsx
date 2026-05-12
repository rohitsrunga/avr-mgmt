import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { PROPERTIES } from '../config'

const PropertyContext = createContext(null)

export function PropertyProvider({ children }) {
  const { user } = useAuth()
  const [propertyId, setPropertyId] = useState(() => {
    return localStorage.getItem('avr.property') || 'casco_bay'
  })

  useEffect(() => {
    if (!user) return
    if (user.property && user.property !== 'both') {
      setPropertyId(user.property)
      localStorage.setItem('avr.property', user.property)
    }
  }, [user])

  function changeProperty(id) {
    setPropertyId(id)
    localStorage.setItem('avr.property', id)
  }

  const value = useMemo(() => {
    const allowedIds = !user
      ? PROPERTIES.map((p) => p.id)
      : user.role === 'owner' || user.role === 'manager'
        ? PROPERTIES.map((p) => p.id)
        : user.property === 'both'
          ? PROPERTIES.map((p) => p.id)
          : [user.property].filter(Boolean)
    const allowedProperties = PROPERTIES.filter((p) => allowedIds.includes(p.id))
    const property = PROPERTIES.find((p) => p.id === propertyId) || PROPERTIES[0]
    return { propertyId: property.id, property, allowedProperties, changeProperty }
  }, [propertyId, user])

  return <PropertyContext.Provider value={value}>{children}</PropertyContext.Provider>
}

export function useProperty() {
  return useContext(PropertyContext)
}
