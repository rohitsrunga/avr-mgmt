import { useEffect, useState } from 'react'
import Banner from '../components/Banner'
import { useApi } from '../hooks/useApi'
import { useProperty } from '../hooks/useProperty'

export default function ParkFly() {
  const api = useApi()
  const { propertyId } = useProperty()
  const [vehicles, setVehicles] = useState([])
  const [showArchive, setShowArchive] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [printing, setPrinting] = useState(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      setError('')
      const path = showArchive ? `/api/parkfly/${propertyId}/archive` : `/api/parkfly/${propertyId}`
      const res = await api.get(path)
      setVehicles(res.vehicles || [])
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => { load() }, [propertyId, showArchive])

  async function update(vehicle, patch) {
    try {
      await api.put(`/api/parkfly/${propertyId}/${vehicle.vehicle_id}`, patch)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold flex-1">Park & Fly</h1>
        <button onClick={() => setShowArchive((a) => !a)} className="btn-secondary text-sm">
          {showArchive ? 'Active' : 'Archive'}
        </button>
        {!showArchive && (
          <button onClick={() => setShowForm((s) => !s)} className="btn-primary text-sm">
            {showForm ? 'Cancel' : '+ New vehicle'}
          </button>
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {showForm && !showArchive && (
        <NewVehicleForm propertyId={propertyId} onCreated={() => { setShowForm(false); load() }} />
      )}

      {vehicles.length === 0 ? (
        <div className="card text-center text-text-muted py-10">
          {showArchive ? 'No archived vehicles.' : 'No active vehicles.'}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {vehicles.map((v) => (
            <div key={v.vehicle_id} className="card relative">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-mono text-accent-teal font-semibold">{v.tag_number}</div>
                  <div className="font-display font-semibold mt-1">{v.guest_name}</div>
                  {v.phone && <div className="tag">{v.phone}</div>}
                </div>
                <span className={`badge ${v.paid ? 'bg-accent-teal/20 text-accent-teal' : 'bg-accent-amber/20 text-accent-amber'}`}>
                  {v.paid ? 'Paid' : 'Unpaid'}
                </span>
              </div>
              <div className="text-sm text-text-body">{v.vehicle_make_model}</div>
              <div className="font-mono text-xs text-text-secondary">{v.license_plate}</div>
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-ink-700 text-center">
                <div>
                  <div className="tag">In</div>
                  <div className="text-sm font-mono">{v.check_in}</div>
                </div>
                <div>
                  <div className="tag">Out</div>
                  <div className="text-sm font-mono">{v.check_out}</div>
                </div>
                <div>
                  <div className="tag">Total</div>
                  <div className="text-sm font-mono">${v.total_fee.toFixed(0)}</div>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {!v.paid && !showArchive && (
                  <button className="btn-primary text-xs flex-1 min-h-0 py-2" onClick={() => update(v, { paid: true })}>
                    Mark paid
                  </button>
                )}
                {!showArchive && (
                  <button className="btn-secondary text-xs flex-1 min-h-0 py-2" onClick={() => update(v, { status: 'archived' })}>
                    Archive
                  </button>
                )}
                <button className="btn-secondary text-xs flex-1 min-h-0 py-2" onClick={() => setPrinting(v)}>
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
    <form onSubmit={submit} className="card border-accent-teal/40 space-y-3">
      <h3 className="font-display text-base font-semibold">New Park & Fly vehicle</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label">Guest name</label><input className="input" required value={form.guest_name} onChange={set('guest_name')} /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={set('phone')} /></div>
        <div><label className="label">Check in</label><input type="date" className="input" required value={form.check_in} onChange={set('check_in')} /></div>
        <div><label className="label">Check out</label><input type="date" className="input" required value={form.check_out} onChange={set('check_out')} /></div>
        <div><label className="label">Vehicle make / model</label><input className="input" required value={form.vehicle_make_model} onChange={set('vehicle_make_model')} /></div>
        <div><label className="label">License plate</label><input className="input" required value={form.license_plate} onChange={set('license_plate')} /></div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-ink-700">
        <div className="text-sm">
          <span className="text-text-secondary">{days} {days === 1 ? 'night' : 'nights'} × $10/night = </span>
          <span className="font-mono font-semibold">${days * 10}</span>
        </div>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Issue tag'}</button>
      </div>
      {err && <div className="text-accent-red text-sm">{err}</div>}
    </form>
  )
}

function PrintAgreement({ vehicle, onClose }) {
  function doPrint() { window.print() }
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 print:bg-white" onClick={onClose}>
      <div className="bg-white text-black rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto print:max-h-none print:rounded-none" onClick={(e) => e.stopPropagation()}>
        <div className="p-8 print:p-12">
          <h1 className="text-2xl font-bold border-b border-black pb-2">Park & Fly Agreement</h1>
          <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
            <div><strong>Tag:</strong> {vehicle.tag_number}</div>
            <div><strong>Issued:</strong> {new Date(vehicle.issued_at).toLocaleDateString()}</div>
            <div><strong>Guest:</strong> {vehicle.guest_name}</div>
            <div><strong>Phone:</strong> {vehicle.phone || '—'}</div>
            <div><strong>Check-in:</strong> {vehicle.check_in}</div>
            <div><strong>Check-out:</strong> {vehicle.check_out}</div>
            <div><strong>Vehicle:</strong> {vehicle.vehicle_make_model}</div>
            <div><strong>Plate:</strong> {vehicle.license_plate}</div>
            <div><strong>Days:</strong> {vehicle.parking_days}</div>
            <div><strong>Total:</strong> ${vehicle.total_fee.toFixed(2)}</div>
          </div>
          <div className="mt-6 text-sm">
            <h2 className="font-bold">Terms</h2>
            <ul className="list-disc list-outside ml-5 mt-2 space-y-1">
              <li>Guests park in designated areas only. Additional charges for oversized vehicles.</li>
              <li>Guests must display Park & Fly Tag on dashboard at all times.</li>
              <li>Hotel not responsible for theft, damage, or loss.</li>
              <li>Vehicles left beyond 2 days without notice may be towed at owner's expense.</li>
              <li>Complimentary shuttle service to/from airport available.</li>
              <li>Extra fees for parking beyond reserved period.</li>
            </ul>
            <p className="mt-3"><strong>Front Desk:</strong> (207) 772-3838</p>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
            <div>
              <div className="border-b border-black h-12"></div>
              <div className="mt-1">Guest signature</div>
            </div>
            <div>
              <div className="border-b border-black h-12"></div>
              <div className="mt-1">Date</div>
            </div>
          </div>
        </div>
        <div className="border-t border-gray-300 px-8 py-3 flex gap-2 print:hidden">
          <button onClick={doPrint} className="btn-primary text-sm">Print</button>
          <button onClick={onClose} className="btn-secondary text-sm">Close</button>
        </div>
      </div>
    </div>
  )
}
