import { useEffect, useMemo, useState } from 'react'
import Banner from '../components/Banner'
import { CONFIG, DINNER_ENABLED_PROPERTIES, DINNER_MENU } from '../config'
import { useApi } from '../hooks/useApi'
import { useProperty } from '../hooks/useProperty'

export default function Dinner() {
  const api = useApi()
  const { propertyId, property } = useProperty()
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [filter, setFilter] = useState('open')
  const [orders, setOrders] = useState([])
  const [error, setError] = useState('')

  const enabled = DINNER_ENABLED_PROPERTIES.has(propertyId)

  async function load() {
    if (!enabled) return
    try {
      setError('')
      const res = await api.get(`/api/dinner-orders/${propertyId}`, { date })
      setOrders(res.orders || [])
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [propertyId, date])

  async function setStatus(order, status) {
    try {
      await api.put(`/api/dinner-orders/${propertyId}/${order.order_id}`, { date, status })
      setOrders((arr) => arr.map((o) =>
        o.order_id === order.order_id ? { ...o, status } : o
      ))
    } catch (e) {
      setError(e.message)
    }
  }

  async function remove(order) {
    if (!confirm(`Delete order for ${order.guest_name}?`)) return
    try {
      await api.del(`/api/dinner-orders/${propertyId}/${order.order_id}`, { date })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return orders
    return orders.filter((o) => o.status === filter)
  }, [orders, filter])

  const counts = useMemo(() => ({
    open: orders.filter((o) => o.status === 'open').length,
    completed: orders.filter((o) => o.status === 'completed').length,
    all: orders.length,
  }), [orders])

  const formUrl = CONFIG.publicFormsBaseUrl
    ? `${CONFIG.publicFormsBaseUrl}/dinner.html?p=${propertyId}`
    : ''

  if (!enabled) {
    return (
      <div className="space-y-5 fade-in">
        <div>
          <h1 className="page-title">Dinner Orders</h1>
          <p className="page-subtitle">Casco Bay evening dinner program.</p>
        </div>
        <Banner tone="info">
          Dinner orders are only available for Casco Bay. Switch properties from the header to access this page.
        </Banner>
      </div>
    )
  }

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="page-title">Dinner Orders</h1>
          <p className="page-subtitle">{property?.name} · evening dinner program.</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input max-w-[180px]"
        />
      </div>

      {formUrl && <PublicFormCard url={formUrl} label="Guest order form" />}

      <div className="flex gap-1.5">
        {[
          { id: 'open', label: 'Open', count: counts.open },
          { id: 'completed', label: 'Completed', count: counts.completed },
          { id: 'all', label: 'All', count: counts.all },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-3.5 py-2 rounded-full text-[13px] font-medium transition-all ${
              filter === tab.id
                ? 'bg-ink text-white'
                : 'bg-white text-ink-body border border-line-subtle hover:border-line'
            }`}
          >
            {tab.label} <span className="tabular-nums opacity-70 ml-1">{tab.count}</span>
          </button>
        ))}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {filtered.length === 0 ? (
        <div className="card text-center py-12 text-ink-muted text-[14px]">
          {orders.length === 0 ? 'No orders submitted yet for this date.' : 'No orders match this filter.'}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((o) => (
            <OrderCard
              key={o.order_id}
              order={o}
              onComplete={() => setStatus(o, 'completed')}
              onReopen={() => setStatus(o, 'open')}
              onDelete={() => remove(o)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PublicFormCard({ url, label }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }
  return (
    <div className="card flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-ink-muted">{label}</div>
        <a href={url} target="_blank" rel="noreferrer" className="text-[14px] text-brand font-mono truncate block hover:underline">
          {url}
        </a>
      </div>
      <button onClick={copy} className="btn-secondary text-[13px] px-3 py-1.5 min-h-0">
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}

function OrderCard({ order, onComplete, onReopen, onDelete }) {
  const sides = DINNER_MENU.sides.filter((s) => order.items?.[s.id])
  const sandwich = DINNER_MENU.sandwiches.find((s) => s.id === order.sandwich)
  const drink = DINNER_MENU.drinks.find((d) => d.id === order.drink)
  const completed = order.status === 'completed'
  return (
    <div className={`card ${completed ? 'bg-surface-subtle' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold text-ink truncate">{order.guest_name}</div>
          <div className="text-[12px] text-ink-muted mt-0.5">
            {order.room_number ? `Room ${order.room_number} · ` : ''}
            {new Date(order.submitted_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
        </div>
        <span className={completed ? 'badge-positive' : 'badge-warning'}>
          {completed ? 'Done' : 'Open'}
        </span>
      </div>

      <ul className="space-y-1.5 mb-4">
        {sides.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-[14px] text-ink">
            <span className="w-1 h-1 bg-ink-muted rounded-full" /> {s.label}
          </li>
        ))}
        {sandwich && sandwich.id !== 'none' && (
          <li className="flex items-center gap-2 text-[14px] text-ink">
            <span className="w-1 h-1 bg-ink-muted rounded-full" /> Sandwich · {sandwich.label}
          </li>
        )}
        {drink && drink.id !== 'none' && (
          <li className="flex items-center gap-2 text-[14px] text-ink">
            <span className="w-1 h-1 bg-ink-muted rounded-full" /> Drink · {drink.label}
          </li>
        )}
      </ul>

      {order.notes && (
        <div className="text-[13px] text-ink-body bg-warning-tint border border-warning/20 rounded-lg px-3 py-2 mb-3">
          {order.notes}
        </div>
      )}

      {completed && order.completed_by && (
        <div className="text-[12px] text-ink-muted mb-3">
          Done by {order.completed_by}{order.completed_at ? ` · ${new Date(order.completed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
        </div>
      )}

      <div className="flex gap-2 pt-3 border-t border-line-subtle">
        {completed ? (
          <button onClick={onReopen} className="btn-secondary text-[13px] flex-1 min-h-0 py-2">Reopen</button>
        ) : (
          <button onClick={onComplete} className="btn-primary text-[13px] flex-1 min-h-0 py-2">Mark made</button>
        )}
        <button onClick={onDelete} className="btn-ghost text-[13px] px-3 min-h-0 py-2" title="Delete order">
          ×
        </button>
      </div>
    </div>
  )
}
