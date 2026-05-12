import { useCallback } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { CONFIG } from '../config'

export function useApi() {
  const { tokens, refreshIdToken, logout } = useAuth()

  const call = useCallback(async (method, path, { body, query } = {}) => {
    let token = tokens?.idToken
    if (!token) {
      token = await refreshIdToken()
    }
    let url = `${CONFIG.apiBaseUrl}${path}`
    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(([_, v]) => v !== undefined && v !== null && v !== '')
      ).toString()
      if (qs) url += `?${qs}`
    }
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) {
      logout()
      throw new Error('Session expired. Please log in again.')
    }
    const text = await res.text()
    const data = text ? safeJson(text) : null
    if (!res.ok) {
      const msg = data?.error || `HTTP ${res.status}`
      throw new Error(msg)
    }
    return data
  }, [tokens, refreshIdToken, logout])

  return {
    get: (path, query) => call('GET', path, { query }),
    post: (path, body, query) => call('POST', path, { body, query }),
    put: (path, body, query) => call('PUT', path, { body, query }),
    del: (path, query) => call('DELETE', path, { query }),
  }
}

function safeJson(text) {
  try { return JSON.parse(text) } catch { return null }
}
