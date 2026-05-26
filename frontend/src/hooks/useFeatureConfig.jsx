import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { TOGGLEABLE_FEATURES } from '../config'
import { useApi } from './useApi'

/**
 * Per-property feature flags fetched from /api/admin/features at sign-in time.
 *
 * `config` is { property_id: [feature_id, ...] }. The provider defaults to
 * "all features enabled in every property" until the first successful fetch,
 * so the UI never flashes hidden tabs to a freshly-loaded session.
 */

const FeatureConfigContext = createContext(null)

function defaultConfig(properties, features) {
  return Object.fromEntries(properties.map((p) => [p, [...features]]))
}

export function FeatureConfigProvider({ children }) {
  const { isAuthenticated } = useAuth()
  const api = useApi()
  const [properties, setProperties] = useState(['casco_bay', 'saco_bay'])
  const [features, setFeatures] = useState(TOGGLEABLE_FEATURES)
  const [config, setConfig] = useState(() => defaultConfig(['casco_bay', 'saco_bay'], TOGGLEABLE_FEATURES))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!isAuthenticated) return
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/api/admin/features')
      // eslint-disable-next-line no-console
      console.debug('[useFeatureConfig] /api/admin/features response:', res)
      if (Array.isArray(res?.properties) && res.properties.length) setProperties(res.properties)
      if (Array.isArray(res?.features) && res.features.length) setFeatures(res.features)
      if (res?.config && typeof res.config === 'object') setConfig(res.config)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [api, isAuthenticated])

  useEffect(() => { load() }, [load])

  const isEnabled = useCallback((featureId, propertyId) => {
    if (!featureId || !propertyId) return false
    // Unknown (non-toggleable) features are always considered enabled — keeps
    // adding new sections cheap without first writing config rows.
    if (!features.includes(featureId)) return true
    const list = config[propertyId]
    if (!Array.isArray(list)) return true  // default-enabled while loading
    return list.includes(featureId)
  }, [config, features])

  const setEnabled = useCallback(async (propertyId, enabledList) => {
    const res = await api.put(`/api/admin/features/${propertyId}`, { enabled: enabledList })
    // Optimistic: trust the PUT response.
    setConfig((prev) => ({ ...prev, [propertyId]: res.enabled || [] }))
    // Truth: immediately re-fetch from /features so the UI shows what's
    // actually persisted. If the round-trip doesn't survive, the toggle
    // snaps back here instead of silently waiting until the next page load.
    try {
      const fresh = await api.get('/api/admin/features')
      if (fresh?.config && typeof fresh.config === 'object') {
        setConfig(fresh.config)
        // eslint-disable-next-line no-console
        console.debug('[useFeatureConfig] post-PUT reload config:', fresh.config)
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[useFeatureConfig] post-PUT reload failed', e)
    }
    return res
  }, [api])

  const value = useMemo(() => ({
    properties, features, config, loading, error, isEnabled, setEnabled, reload: load,
  }), [properties, features, config, loading, error, isEnabled, setEnabled, load])

  return <FeatureConfigContext.Provider value={value}>{children}</FeatureConfigContext.Provider>
}

export function useFeatureConfig() {
  const ctx = useContext(FeatureConfigContext)
  if (!ctx) {
    // Tolerant fallback so unwrapped tests don't crash; treats every feature as enabled.
    return {
      properties: ['casco_bay', 'saco_bay'],
      features: TOGGLEABLE_FEATURES,
      config: defaultConfig(['casco_bay', 'saco_bay'], TOGGLEABLE_FEATURES),
      loading: false,
      error: '',
      isEnabled: () => true,
      setEnabled: async () => ({}),
      reload: async () => {},
    }
  }
  return ctx
}
