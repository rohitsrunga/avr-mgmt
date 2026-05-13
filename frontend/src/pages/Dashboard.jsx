import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
  const [parkfly, setParkfly] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError('')
      try {
        const [dash, low, parkflyRes, ...shiftData] = await Promise.all([
          api.get(`/api/reports/${propertyId}/dashboard`).catch(() => ({ data: {}, synced_at: '' })),
          api.get(`/api/inventory/${propertyId}/alerts`).catch(() => ({ alerts: [] })),
          api.get(`/api/parkfly/${propertyId}`).catch(() => ({ vehicles: [] })),
          ...SHIFTS.map((s) =>
            api.get(`/api/shifts/${propertyId}/tasks`, { shift: s.id }).catch(() => ({ tasks: [] }))
          ),
        ])
        if (cancelled) return
        setDashboard(dash)
        setAlerts((low.alerts || []).slice(0, 5))
        setParkfly((parkflyRes.vehicles || []).slice(0, 6))
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

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const data = dashboard?.data || {}
  const syncedAt = dashboard?.synced_at

  return (
    <div className="space-y-8 fade-in">
      <div>
        <div className="text-[13px] text-ink-muted">{today}</div>
        <h1 className="page-title mt-1">{property?.name}</h1>
        <p className="page-subtitle">Today&apos;s operational snapshot.</p>
      </div>

      {propertyId === 'casco_bay' && (
        <Banner tone="info">
          PMS metrics are not connected for this property. The tiles below stay blank.
        </Banner>
      )}
      {propertyId === 'saco_bay' && syncedAt && (
        <Banner tone="success">
          Synced from Cloudbeds {new Date(syncedAt).toLocaleString()}.
        </Banner>
      )}
      {propertyId === 'saco_bay' && !syncedAt && (
        <Banner tone="warn">
          No Cloudbeds sync yet. Run scripts/cloudbeds_oauth_setup.py and enable the sync schedule.
        </Banner>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard label="Occupancy" value={fmtPct(data.occupancy_pct)} />
        <MetricCard label="ADR" value={fmtMoney(data.adr)} />
        <MetricCard label="RevPAR" value={fmtMoney(data.revpar)} />
        <MetricCard label="Arriving today" value={data.arriving_today ?? '—'} />
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <h2 className="section-title">Shift progress</h2>
            <Link to="/app/shifts" className="btn-link text-[14px]">Open</Link>
          </div>
          <div className="space-y-4">
            {SHIFTS.map((s) => {
              const p = shiftProgress[s.id] || { done: 0, total: 0 }
              const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
              return (
                <Link to="/app/shifts" key={s.id} className="block group">
                  <div className="flex items-center gap-4">
                    <div className="w-12">
                      <div className="text-[15px] font-medium text-ink leading-none">{s.label}</div>
                      <div className="text-[11px] text-ink-muted mt-1">{s.range}</div>
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between text-[12px] mb-1.5 text-ink-muted">
                        <span></span>
                        <span className="tabular-nums">{p.done} / {p.total}</span>
                      </div>
                      <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                        <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <h2 className="section-title">Low stock alerts</h2>
            <Link to="/app/inventory" className="btn-link text-[14px]">All inventory</Link>
          </div>
          {alerts.length === 0 ? (
            <div className="text-[14px] text-ink-muted py-8 text-center">No items below threshold.</div>
          ) : (
            <ul className="space-y-3">
              {alerts.map((a) => (
                <li key={`${a.category}#${a.item_id}`} className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-ink truncate">{a.item_name}</div>
                    <div className="text-[12px] text-ink-muted capitalize">{a.category.replace(/_/g, ' ')}</div>
                  </div>
                  <div className="w-32"><StockBar current={a.current_stock} par={a.par_level} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ParkFlyContainer
        propertyId={propertyId}
        vehicles={parkfly}
        onChange={() => {
          api.get(`/api/parkfly/${propertyId}`).then((r) => setParkfly((r.vehicles || []).slice(0, 6))).catch(() => {})
        }}
      />
    </div>
  )
}

function ParkFlyContainer({ propertyId, vehicles, onChange }) {
  const api = useApi()
  const [showForm, setShowForm] = useState(false)
  const [printing, setPrinting] = useState(null)
  const [error, setError] = useState('')

  async function update(vehicle, patch) {
    try {
      await api.put(`/api/parkfly/${propertyId}/${vehicle.vehicle_id}`, patch)
      onChange?.()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="section-title">Park and Fly</h2>
          <p className="text-[13px] text-ink-muted mt-0.5">Active vehicles parked at this property</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-secondary text-[14px]">
          {showForm ? 'Cancel' : 'New vehicle'}
        </button>
      </div>

      {error && <div className="mb-4"><Banner tone="error">{error}</Banner></div>}

      {showForm && (
        <NewVehicleForm propertyId={propertyId} onCreated={() => { setShowForm(false); onChange?.() }} />
      )}

      {vehicles.length === 0 ? (
        <div className="text-[14px] text-ink-muted py-8 text-center">No active vehicles.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
          {vehicles.map((v) => (
            <div key={v.vehicle_id} className="border border-line-subtle rounded-lg p-4 bg-surface-subtle">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-mono text-[13px] text-brand font-medium">{v.tag_number}</div>
                  <div className="text-[15px] font-medium text-ink mt-1">{v.guest_name}</div>
                  {v.phone && <div className="text-[12px] text-ink-muted">{v.phone}</div>}
                </div>
                <span className={v.paid ? 'badge-positive' : 'badge-warning'}>
                  {v.paid ? 'Paid' : 'Unpaid'}
                </span>
              </div>
              <div className="text-[13px] text-ink-body">{v.vehicle_make_model}</div>
              <div className="font-mono text-[12px] text-ink-muted">{v.license_plate}</div>
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-line-subtle text-center">
                <div>
                  <div className="text-[11px] text-ink-muted">In</div>
                  <div className="text-[13px] tabular-nums mt-0.5">{v.check_in}</div>
                </div>
                <div>
                  <div className="text-[11px] text-ink-muted">Out</div>
                  <div className="text-[13px] tabular-nums mt-0.5">{v.check_out}</div>
                </div>
                <div>
                  <div className="text-[11px] text-ink-muted">Total</div>
                  <div className="text-[13px] tabular-nums mt-0.5">${v.total_fee.toFixed(0)}</div>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {!v.paid && (
                  <button className="btn-primary text-[12px] flex-1 min-h-0 py-1.5" onClick={() => update(v, { paid: true })}>
                    Mark paid
                  </button>
                )}
                <button className="btn-secondary text-[12px] flex-1 min-h-0 py-1.5" onClick={() => update(v, { status: 'archived' })}>
                  Archive
                </button>
                <button className="btn-secondary text-[12px] flex-1 min-h-0 py-1.5" onClick={() => setPrinting(v)}>
                  Print
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {printing && <PrintAgreement vehicle={printing} onClose={() => setPrinting(null)} />}
    </div>
  )
}

function NewVehicleForm({ propertyId, onCreated }) {
  const api = useApi()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    guest_name: '',
    phone: '',
    check_in: today,
    check_out: today,
    vehicle_make_model: '',
    license_plate: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })) }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await api.post(`/api/parkfly/${propertyId}`, form)
      onCreated?.()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const days = (() => {
    if (!form.check_in || !form.check_out) return 0
    const d1 = new Date(form.check_in), d2 = new Date(form.check_out)
    return Math.max(0, Math.round((d2 - d1) / 86400000))
  })()

  return (
    <form onSubmit={submit} className="border border-line-subtle rounded-lg p-5 bg-surface-subtle mb-4 space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div><label className="label">Guest name</label><input className="input" required value={form.guest_name} onChange={set('guest_name')} /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={set('phone')} /></div>
        <div><label className="label">Check in</label><input type="date" className="input" required value={form.check_in} onChange={set('check_in')} /></div>
        <div><label className="label">Check out</label><input type="date" className="input" required value={form.check_out} onChange={set('check_out')} /></div>
        <div><label className="label">Vehicle make / model</label><input className="input" required value={form.vehicle_make_model} onChange={set('vehicle_make_model')} /></div>
        <div><label className="label">License plate</label><input className="input" required value={form.license_plate} onChange={set('license_plate')} /></div>
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-line-subtle">
        <div className="text-[14px] text-ink-body">
          <span className="text-ink-muted">{days} {days === 1 ? 'night' : 'nights'} × $10/night = </span>
          <span className="font-medium text-ink tabular-nums">${days * 10}</span>
        </div>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Issue tag'}</button>
      </div>
      {err && <div className="text-danger text-[14px]">{err}</div>}
    </form>
  )
}

function PrintAgreement({ vehicle, onClose }) {
  function doPrint() { window.print() }
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:bg-white print:backdrop-blur-none" onClick={onClose}>
      <div className="bg-white text-ink rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-elevated print:max-h-none print:rounded-none print:shadow-none" onClick={(e) => e.stopPropagation()}>
        <div className="p-8 print:p-12">
          <h1 className="text-2xl font-semibold tracking-tight border-b border-line pb-2">Park and Fly Agreement</h1>
          <div className="grid grid-cols-2 gap-4 mt-5 text-[14px]">
            <div><strong className="font-medium">Tag:</strong> {vehicle.tag_number}</div>
            <div><strong className="font-medium">Issued:</strong> {new Date(vehicle.issued_at).toLocaleDateString()}</div>
            <div><strong className="font-medium">Guest:</strong> {vehicle.guest_name}</div>
            <div><strong className="font-medium">Phone:</strong> {vehicle.phone || '—'}</div>
            <div><strong className="font-medium">Check-in:</strong> {vehicle.check_in}</div>
            <div><strong className="font-medium">Check-out:</strong> {vehicle.check_out}</div>
            <div><strong className="font-medium">Vehicle:</strong> {vehicle.vehicle_make_model}</div>
            <div><strong className="font-medium">Plate:</strong> {vehicle.license_plate}</div>
            <div><strong className="font-medium">Days:</strong> {vehicle.parking_days}</div>
            <div><strong className="font-medium">Total:</strong> ${vehicle.total_fee.toFixed(2)}</div>
          </div>
          <div className="mt-6 text-[14px]">
            <h2 className="font-semibold">Terms</h2>
            <ul className="list-disc list-outside ml-5 mt-2 space-y-1 text-ink-body">
              <li>Guests park in designated areas only. Additional charges for oversized vehicles.</li>
              <li>Guests must display Park and Fly tag on dashboard at all times.</li>
              <li>Hotel not responsible for theft, damage, or loss.</li>
              <li>Vehicles left beyond 2 days without notice may be towed at owner&apos;s expense.</li>
              <li>Complimentary shuttle service to/from airport available.</li>
              <li>Extra fees for parking beyond reserved period.</li>
            </ul>
            <p className="mt-3"><strong className="font-medium">Front Desk:</strong> (207) 772-3838</p>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-8 text-[14px]">
            <div>
              <div className="border-b border-ink h-12"></div>
              <div className="mt-1 text-ink-muted">Guest signature</div>
            </div>
            <div>
              <div className="border-b border-ink h-12"></div>
              <div className="mt-1 text-ink-muted">Date</div>
            </div>
          </div>
        </div>
        <div className="border-t border-line-subtle px-8 py-4 flex gap-2 print:hidden">
          <button onClick={doPrint} className="btn-primary">Print</button>
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
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
