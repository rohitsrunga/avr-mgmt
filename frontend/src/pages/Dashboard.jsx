import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import Banner from '../components/Banner'
import MetricCard from '../components/MetricCard'
import StockBar from '../components/StockBar'
import { SHIFTS } from '../config'
import { useApi } from '../hooks/useApi'
import { useProperty } from '../hooks/useProperty'

export default function Dashboard() {
  const api = useApi()
  const { propertyId, property } = useProperty()
  const [dashboard, setDashboard] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [shiftProgress, setShiftProgress] = useState({})
  const [occupancySeries, setOccupancySeries] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError('')
      try {
        const [dash, low, occ, ...shiftData] = await Promise.all([
          api.get(`/api/reports/${propertyId}/dashboard`).catch(() => ({ data: {}, synced_at: '' })),
          api.get(`/api/inventory/${propertyId}/alerts`).catch(() => ({ alerts: [] })),
          api.get(`/api/reports/${propertyId}/occupancy`, { period: '12' }).catch(() => ({ series: [] })),
          ...SHIFTS.map((s) =>
            api.get(`/api/shifts/${propertyId}/tasks`, { shift: s.id }).catch(() => ({ tasks: [] }))
          ),
        ])
        if (cancelled) return
        setDashboard(dash)
        setAlerts((low.alerts || []).slice(0, 5))
        setOccupancySeries(occ.series || [])
        const progress = {}
        SHIFTS.forEach((s, i) => {
          const tasks = shiftData[i].tasks || []
          const done = tasks.filter((t) => t.completed).length
          progress[s.id] = { done, total: tasks.length }
        })
        setShiftProgress(progress)
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    }
    load()
    return () => { cancelled = true }
  }, [propertyId])

  const data = dashboard?.data || {}
  const synced = dashboard?.synced_at

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-2xl sm:text-3xl font-display font-semibold">{property?.name}</h1>
        <p className="text-text-secondary text-sm">Today's snapshot</p>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {propertyId === 'casco_bay' && (
        <Banner tone="info">
          PMS metrics not connected for Casco Bay (uses Choice Advantage).
          Reports show operational data only.
        </Banner>
      )}
      {propertyId === 'saco_bay' && synced && (
        <Banner tone="success">
          Last synced from Cloudbeds: {new Date(synced).toLocaleString()}
        </Banner>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard label="Occupancy" value={fmtPct(data.occupancy_pct)} accent="teal" />
        <MetricCard label="ADR" value={fmtMoney(data.adr)} accent="amber" />
        <MetricCard label="RevPAR" value={fmtMoney(data.revpar)} accent="blue" />
        <MetricCard label="Arriving Today" value={data.arriving_today ?? '—'} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-display text-lg font-semibold mb-4">Shift progress</h2>
          <div className="space-y-3">
            {SHIFTS.map((s) => {
              const p = shiftProgress[s.id] || { done: 0, total: 0 }
              const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
              return (
                <Link to="/app/shifts" key={s.id} className="block">
                  <div className="flex items-center gap-3 hover:bg-ink-700/50 rounded-md p-2 -mx-2 transition-colors">
                    <div className="w-12 text-xs font-mono uppercase text-text-secondary">{s.label}</div>
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary">{s.range}</span>
                        <span className="font-mono">{p.done}/{p.total}</span>
                      </div>
                      <div className="h-2 bg-ink-700 rounded overflow-hidden">
                        <div className="h-full bg-accent-teal" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold">Low stock alerts</h2>
            <Link to="/app/inventory" className="text-xs text-accent-teal hover:underline">View all →</Link>
          </div>
          {alerts.length === 0 ? (
            <div className="text-sm text-text-muted">No items below threshold.</div>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li key={`${a.category}#${a.item_id}`} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{a.item_name}</div>
                    <div className="tag">{a.category.replace(/_/g, ' ')}</div>
                  </div>
                  <div className="w-32"><StockBar current={a.current_stock} par={a.par_level} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {occupancySeries.length > 0 && (
        <div className="card">
          <h2 className="font-display text-lg font-semibold mb-4">Occupancy trend (12 months)</h2>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={occupancySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a2235" />
                <XAxis dataKey="date" stroke="#5a6778" tick={{ fontSize: 10 }} />
                <YAxis stroke="#5a6778" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#141924', border: '1px solid #1e2a3a', borderRadius: 8 }} />
                <Line type="monotone" dataKey="occupancy_pct" stroke="#2d8e72" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtPct(v) {
  if (v == null || v === '') return '—'
  return `${Math.round(Number(v))}%`
}
function fmtMoney(v) {
  if (v == null || v === '') return '—'
  return `$${Number(v).toFixed(0)}`
}
