import { useEffect, useState } from 'react'
import Banner from './Banner'
import SectionCard from './SectionCard'
import { useApi } from '../hooks/useApi'

// Three-stage money trace for a property over a date range, anchored on
// transaction date. High-level pipeline overview (Charged → Received →
// Posted) on top, then a detailed table where guest stays drop off the
// Outstanding list once a payout has accounted for their payment.

const usd = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usdc = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function isoDaysAgo(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export default function FinanceReconciliation({ propertyId }) {
  const api = useApi()
  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(isoDaysAgo(0))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showReconciled, setShowReconciled] = useState(false)
  const [showExceptions, setShowExceptions] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/api/finance/${propertyId}/reconciliation`, { from, to })
      setData(res)
    } catch (e) {
      setError(e.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }
  // Auto-load on mount and whenever the property changes; date changes are
  // applied via the Run button so we don't fire a request per keystroke.
  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyId])

  const t = data?.totals || {}
  const stays = data?.stays || []
  const outstanding = stays.filter((s) => !s.reconciled)
  const reconciled = stays.filter((s) => s.reconciled)
  const exceptions = data?.exceptions || []
  const collectedPct = t.charged ? Math.round((t.received / t.charged) * 100) : 0

  return (
    <SectionCard
      title="Reconciliation"
      subtitle="Cloudbeds · charged → received → posted to bank, by transaction date"
      actions={
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-ink-muted">
            From
            <input type="date" className="input min-h-0 py-1 text-[13px] block" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-[11px] text-ink-muted">
            To
            <input type="date" className="input min-h-0 py-1 text-[13px] block" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button onClick={load} disabled={loading} className="btn-primary py-1.5 text-[13px]">
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}

      {data && data.enabled === false && !error && (
        <div className="text-[14px] text-ink-muted py-8 text-center">
          {data.error || 'Reconciliation is only available for Cloudbeds-connected properties.'}
        </div>
      )}

      {data && data.enabled && (
        <div className="space-y-5">
          {/* Pipeline overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stage label="Charged" value={usd(t.charged)} sub={`${stays.length} stays`} />
            <Stage label="Received" value={usd(t.received)} sub={`${collectedPct}% of charged`} arrow />
            <Stage
              label="Posted to bank"
              value={usd(t.posted_net)}
              sub={t.outstanding > 0 ? `${usd(t.outstanding)} awaiting payout` : 'fully paid out'}
              arrow
              tone={t.outstanding > 0 ? 'warning' : 'positive'}
            />
          </div>
          {(t.fees > 0 || t.posted_gross > 0) && (
            <div className="text-[12px] text-ink-muted -mt-2">
              Payout gross {usdc(t.posted_gross)} · processor fees {usdc(t.fees)} · net deposited {usdc(t.posted_net)}
            </div>
          )}

          {/* Outstanding */}
          <div>
            <h3 className="section-title mb-2">
              Outstanding · {outstanding.length} {outstanding.length === 1 ? 'stay' : 'stays'}
              <span className="text-ink-muted font-normal"> · received but not yet posted</span>
            </h3>
            {outstanding.length === 0 ? (
              <div className="text-[13px] text-ink-muted py-6 text-center">Everything in range is reconciled. 🎉</div>
            ) : (
              <StayTable stays={outstanding} mode="outstanding" />
            )}
          </div>

          {/* Reconciled (collapsed) */}
          {reconciled.length > 0 && (
            <div>
              <button onClick={() => setShowReconciled((v) => !v)} className="text-[13px] font-medium text-ink-body hover:text-ink flex items-center gap-1">
                <span className="text-ink-muted">{showReconciled ? '▾' : '▸'}</span>
                Reconciled · {reconciled.length} {reconciled.length === 1 ? 'stay' : 'stays'} · {usd(t.posted_net)} to bank
              </button>
              {showReconciled && <div className="mt-2"><StayTable stays={reconciled} mode="reconciled" /></div>}
            </div>
          )}

          {/* Exceptions (collapsed) */}
          {exceptions.length > 0 && (
            <div>
              <button onClick={() => setShowExceptions((v) => !v)} className="text-[13px] font-medium text-danger hover:opacity-80 flex items-center gap-1">
                <span>{showExceptions ? '▾' : '▸'}</span>
                Exceptions · {exceptions.length} payout{exceptions.length === 1 ? '' : 's'} with no matched payment in range
              </button>
              {showExceptions && (
                <div className="mt-2 overflow-x-auto">
                  <table className="table-clean text-[13px]">
                    <thead><tr><th>Reservation</th><th className="w-28">Payout date</th><th className="w-28 text-right">Gross</th><th className="w-28 text-right">Net to bank</th></tr></thead>
                    <tbody>
                      {exceptions.map((e) => (
                        <tr key={e.reservation}>
                          <td className="font-mono text-[12px]">{e.reservation}</td>
                          <td className="tabular-nums">{e.payout_date || '—'}</td>
                          <td className="tabular-nums text-right">{usdc(e.posted_gross)}</td>
                          <td className="tabular-nums text-right">{usdc(e.posted_net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {data.synced_at && (
            <div className="text-[11px] text-ink-muted">As of {new Date(data.synced_at).toLocaleString()}</div>
          )}
        </div>
      )}
    </SectionCard>
  )
}

function Stage({ label, value, sub, arrow, tone = 'neutral' }) {
  const toneCls = tone === 'warning' ? 'text-warning' : tone === 'positive' ? 'text-positive' : 'text-ink'
  return (
    <div className="relative bg-surface-subtle border border-line-subtle rounded-xl px-4 py-3">
      {arrow && <span className="hidden sm:block absolute -left-2.5 top-1/2 -translate-y-1/2 text-ink-muted text-lg">→</span>}
      <div className="text-[11px] uppercase tracking-[0.06em] text-ink-muted">{label}</div>
      <div className={`text-[22px] font-semibold tabular-nums ${toneCls}`}>{value}</div>
      <div className="text-[12px] text-ink-muted">{sub}</div>
    </div>
  )
}

function StayTable({ stays, mode }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-clean text-[13px]">
        <thead>
          <tr>
            <th>Guest</th>
            <th className="w-28">Reservation</th>
            <th className="w-24 text-right">Charged</th>
            <th className="w-24 text-right">Paid</th>
            <th className="w-24 text-right">Posted</th>
            {mode === 'outstanding'
              ? <th className="w-28 text-right">Outstanding</th>
              : <th className="w-28">Payout</th>}
          </tr>
        </thead>
        <tbody>
          {stays.map((s) => (
            <tr key={s.reservation}>
              <td>
                <div className="text-ink font-medium">{s.guest}</div>
                {s.cards?.length > 0 && <div className="text-[10px] text-ink-muted">···{s.cards.join(', ···')}</div>}
              </td>
              <td className="font-mono text-[12px] text-ink-body">{s.reservation}</td>
              <td className="tabular-nums text-right">{usdc(s.charged)}</td>
              <td className="tabular-nums text-right">{usdc(s.received)}</td>
              <td className="tabular-nums text-right">{usdc(s.posted_net)}</td>
              {mode === 'outstanding' ? (
                <td className="tabular-nums text-right font-medium text-warning">{usdc(s.outstanding)}</td>
              ) : (
                <td className="tabular-nums text-ink-muted">{s.payout_date || '—'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
