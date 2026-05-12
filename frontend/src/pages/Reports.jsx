import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import Banner from '../components/Banner'
import MetricCard from '../components/MetricCard'
import { PROPERTIES } from '../config'
import { useApi } from '../hooks/useApi'
import { useProperty } from '../hooks/useProperty'

export default function Reports() {
  const api = useApi()
  const { propertyId } = useProperty()
  const [revenue, setRevenue] = useState({ casco_bay: [], saco_bay: [] })
  const [occupancy, setOccupancy] = useState({ casco_bay: [], saco_bay: [] })
  const [syncStatus, setSyncStatus] = useState({})
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        setError('')
        const [r1, r2, o1, o2, sync] = await Promise.all([
          api.get(`/api/reports/casco_bay/revenue`).catch(() => ({ series: [] })),
          api.get(`/api/reports/saco_bay/revenue`).catch(() => ({ series: [] })),
          api.get(`/api/reports/casco_bay/occupancy`).catch(() => ({ series: [] })),
          api.get(`/api/reports/saco_bay/occupancy`).catch(() => ({ series: [] })),
          api.get(`/api/reports/sync-status`).catch(() => ({ sync_status: {} })),
        ])
        setRevenue({ casco_bay: r1.series, saco_bay: r2.series })
        setOccupancy({ casco_bay: o1.series, saco_bay: o2.series })
        setSyncStatus(sync.sync_status || {})
      } catch (e) {
        setError(e.message)
      }
    }
    load()
  }, [propertyId])

  // Compute YTD revenue for Saco (the only PMS-connected property)
  const sacoYtd = revenue.saco_bay.reduce((acc, x) => acc + (Number(x.revenue) || 0), 0)
  const sacoLatestOcc = occupancy.saco_bay.length
    ? occupancy.saco_bay.slice(-90).reduce((a, x) => a + Number(x.occupancy_pct || 0), 0) / Math.min(90, occupancy.saco_bay.length)
    : 0

  // Combined revenue chart
  const combinedRevenue = mergeMonthlySeries(revenue.casco_bay, revenue.saco_bay)
  const combinedOccupancy = mergeDailySeries(occupancy.casco_bay, occupancy.saco_bay, 'occupancy_pct')

  return (
    <div className="space-y-5 fade-in">
      <div>
        <h1 className="text-2xl sm:text-3xl font-display font-semibold">Reports</h1>
        <div className="flex flex-wrap gap-3 mt-1 text-xs text-text-secondary">
          {PROPERTIES.map((p) => (
            <div key={p.id}>
              {p.short}: {syncStatus[p.id] ? `synced ${new Date(syncStatus[p.id]).toLocaleString()}` : 'no sync'}
            </div>
          ))}
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      <Banner tone="info">Casco Bay uses Choice Advantage (no API). PMS metrics shown for Saco Bay (Cloudbeds) only.</Banner>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard label="Saco Bay YTD Rev" value={`$${Math.round(sacoYtd).toLocaleString()}`} accent="amber" />
        <MetricCard label="Saco Bay 90d Occ" value={`${Math.round(sacoLatestOcc)}%`} accent="teal" />
        <MetricCard label="Casco Bay" value="Manual" sub="No PMS connected" />
        <MetricCard label="Properties" value="2" sub="Active" />
      </div>

      <div className="card">
        <h2 className="font-display text-lg font-semibold mb-4">Monthly revenue</h2>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={combinedRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2235" />
              <XAxis dataKey="month" stroke="#5a6778" tick={{ fontSize: 11 }} />
              <YAxis stroke="#5a6778" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#141924', border: '1px solid #1e2a3a', borderRadius: 8 }} />
              <Bar dataKey="casco_bay" fill="#2d8e72" name="Casco Bay" />
              <Bar dataKey="saco_bay" fill="#e8a838" name="Saco Bay" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h2 className="font-display text-lg font-semibold mb-4">Occupancy trend</h2>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={combinedOccupancy}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2235" />
              <XAxis dataKey="date" stroke="#5a6778" tick={{ fontSize: 10 }} />
              <YAxis stroke="#5a6778" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#141924', border: '1px solid #1e2a3a', borderRadius: 8 }} />
              <Line type="monotone" dataKey="casco_bay" stroke="#2d8e72" strokeWidth={2} dot={false} name="Casco Bay" />
              <Line type="monotone" dataKey="saco_bay" stroke="#e8a838" strokeWidth={2} dot={false} name="Saco Bay" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function mergeMonthlySeries(a, b) {
  const map = new Map()
  for (const r of a) map.set(r.month, { month: r.month, casco_bay: Number(r.revenue) || 0, saco_bay: 0 })
  for (const r of b) {
    const cur = map.get(r.month) || { month: r.month, casco_bay: 0, saco_bay: 0 }
    cur.saco_bay = Number(r.revenue) || 0
    map.set(r.month, cur)
  }
  return Array.from(map.values()).sort((x, y) => x.month.localeCompare(y.month))
}

function mergeDailySeries(a, b, key) {
  const map = new Map()
  for (const r of a) map.set(r.date, { date: r.date, casco_bay: Number(r[key]) || 0, saco_bay: 0 })
  for (const r of b) {
    const cur = map.get(r.date) || { date: r.date, casco_bay: 0, saco_bay: 0 }
    cur.saco_bay = Number(r[key]) || 0
    map.set(r.date, cur)
  }
  return Array.from(map.values()).sort((x, y) => x.date.localeCompare(y.date))
}
