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

// Compact "Apr 5" from a YYYY-MM-DD string (parsed as local to avoid the
// UTC-midnight off-by-one).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function shortDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [, m, d] = iso.split('-')
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`
}
function stayRange(s) {
  const ci = shortDate(s.checkin)
  const co = shortDate(s.checkout)
  if (ci && co) return `${ci} – ${co}`
  return ci || co || ''
}

export default function FinanceReconciliation({ propertyId }) {
  const api = useApi()
  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(isoDaysAgo(0))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hideReconciled, setHideReconciled] = useState(false)
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
  const reconciledCount = stays.filter((s) => s.reconciled).length
  const visible = hideReconciled ? stays.filter((s) => !s.reconciled) : stays
  const exceptions = data?.exceptions || []
  const collectedPct = t.charged ? Math.round((t.received / t.charged) * 100) : 0

  return (
    <SectionCard
      title="Reconciliation"
      subtitle="Cloudbeds · booked → authorized/collected → posted to bank, for stays checking out in range"
      actions={
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-ink-muted">
            Checkout from
            <input type="date" className="input min-h-0 py-1 text-[13px] block" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-[11px] text-ink-muted">
            Checkout to
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
            <Stage label="Booked" value={usd(t.charged)} sub={`${stays.length} stays`} />
            <Stage label="Authorized / Collected" value={usd(t.received)} sub={`${collectedPct}% of booked`} arrow />
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

          {/* Granular per-stay money trace */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="section-title">
                Stays · {visible.length}{hideReconciled && reconciledCount > 0 ? ` of ${stays.length}` : ''}
                <span className="text-ink-muted font-normal"> · booked → authorized/collected → posted per guest</span>
              </h3>
              {reconciledCount > 0 && (
                <button
                  type="button"
                  onClick={() => setHideReconciled((v) => !v)}
                  className={`text-[12px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    hideReconciled
                      ? 'bg-brand-tint border-brand text-brand'
                      : 'bg-white border-line text-ink-body hover:border-ink-muted'
                  }`}
                >
                  {hideReconciled ? `Reconciled hidden · show all` : `Hide ${reconciledCount} reconciled`}
                </button>
              )}
            </div>
            {visible.length === 0 ? (
              <div className="text-[13px] text-ink-muted py-6 text-center">No stays in range.</div>
            ) : (
              <StayTable stays={visible} />
            )}
          </div>

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

function statusOf(s) {
  if (s.reconciled) return { tone: 'positive', label: 'Posted', note: s.payout_date }
  if (s.posted_net > 0) return { tone: 'warning', label: 'Partial', note: `${usdc(s.outstanding)} left` }
  if (s.received > 0.01) return { tone: 'warning', label: 'Awaiting payout', note: usdc(s.outstanding) }
  return { tone: 'neutral', label: 'Unpaid', note: '' }
}

function StayTable({ stays }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-clean text-[13px]">
        <thead>
          <tr>
            <th>Guest</th>
            <th className="w-28">Reservation</th>
            <th className="w-24 text-right">Booked</th>
            <th className="w-32 text-right">Authorized / Collected</th>
            <th className="w-20 text-right">Fees</th>
            <th className="w-24 text-right">Posted</th>
            <th className="w-40">Status</th>
          </tr>
        </thead>
        <tbody>
          {stays.map((s) => {
            const st = statusOf(s)
            return (
              <tr key={s.reservation}>
                <td>
                  <div className="text-ink font-medium">{s.guest}</div>
                  {stayRange(s) && <div className="text-[10px] text-ink-muted tabular-nums">{stayRange(s)}</div>}
                </td>
                <td className="font-mono text-[12px] text-ink-body">{s.reservation}</td>
                <td className="tabular-nums text-right">{usdc(s.charged)}</td>
                <td className="tabular-nums text-right">{usdc(s.received)}</td>
                <td className={`tabular-nums text-right ${s.fees > 0 ? 'text-ink-muted' : 'text-ink-faint'}`}>{s.fees > 0 ? `−${usdc(s.fees)}` : usdc(0)}</td>
                <td className={`tabular-nums text-right ${s.posted_net > 0 ? 'text-ink' : 'text-ink-faint'}`}>{usdc(s.posted_net)}</td>
                <td>
                  <span className={`badge-${st.tone}`}>{st.label}</span>
                  {st.note && <span className="text-[10px] text-ink-muted ml-1.5">{st.note}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
