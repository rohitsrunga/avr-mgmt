import { useEffect, useState } from 'react'
import Banner from './Banner'
import SectionCard from './SectionCard'
import { useApi } from '../hooks/useApi'

// Weekly payables / obligations calendar. Rows = USALI line ▸ vendor ▸ hotel
// (with the funding account); columns = weeks across the horizon; each cell =
// the amount expected that week, estimated from the prior-year actual in the
// closest week. A TOTAL EXPENSES row sums every line per week; the current week
// is highlighted; month boundaries get a left divider. Obligations only —
// vendor invoices, payroll, rent/leases, loans, insurance, utilities, taxes &
// service contracts; day-to-day card spend is excluded. The obligations are a
// hand-maintained config (config/payment_calendar_config.json); amounts are
// estimated and published to avr-finance by scripts/estimate_payment_calendar.py.

const HOTEL_DOT = { 'Casco Bay': '#0a84ff', 'Saco Bay': '#ff9500' }

const money = (n) =>
  n == null || Math.round(n) === 0
    ? <span className="text-line">·</span>
    : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

function colCls(week) {
  const parts = []
  if (week.month_start) parts.push('border-l border-line')
  if (week.is_current) parts.push('bg-brand-tint')
  return parts.join(' ')
}

// One <td> per week + a row-total cell.
function Cells({ cells, weeks, bold }) {
  const total = cells.reduce((a, b) => a + (b || 0), 0)
  return (
    <>
      {cells.map((v, i) => (
        <td key={i} className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${colCls(weeks[i])}`}>
          {money(v)}
        </td>
      ))}
      <td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${bold ? 'font-semibold' : 'font-medium'}`}>
        {money(total)}
      </td>
    </>
  )
}

export default function PaymentCalendar({ propertyId }) {
  const api = useApi()
  const [months, setMonths] = useState(6)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      setData(await api.get(`/api/finance/${propertyId}/payment-calendar`, { months }))
    } catch (e) { setError(e.message); setData(null) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyId, months])

  const weeks = data?.weeks || []
  const subtitle =
    `${weeks[0]?.label ?? ''} … ${weeks[weeks.length - 1]?.label ?? ''} · ` +
    'amounts estimated from the prior-year actual in the closest week' +
    (data?.synced_at ? ` · synced ${new Date(data.synced_at).toLocaleDateString()}` : '')

  const monthsToggle = (
    <div className="inline-flex rounded-full bg-surface-muted p-0.5">
      {[6, 12].map((m) => (
        <button
          key={m}
          onClick={() => setMonths(m)}
          className={`px-3 py-1 rounded-full text-[12px] font-medium transition ${
            months === m ? 'bg-white text-ink shadow-sm' : 'text-ink-muted'
          }`}
        >
          {m} mo
        </button>
      ))}
    </div>
  )

  const hasRows = (data?.depts || []).some((d) => d.lines.length)

  return (
    <SectionCard title="Payment calendar" subtitle={subtitle} actions={monthsToggle}>
      {error && <Banner tone="error">{error}</Banner>}
      {loading && <p className="text-[13px] text-ink-muted">Loading…</p>}
      {!loading && !error && !hasRows && (
        <Banner tone="info">No obligations published yet. Run <code>scripts/estimate_payment_calendar.py</code>.</Banner>
      )}
      {!loading && !error && hasRows && (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="text-[12px] border-collapse min-w-full tabular-nums">
            <thead>
              <tr className="text-ink-muted">
                <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left font-semibold min-w-[220px]">
                  USALI line · vendor
                </th>
                {weeks.map((w, i) => (
                  <th
                    key={i}
                    className={`px-2 py-1.5 text-right font-medium whitespace-nowrap ${colCls(w)}`}
                  >
                    {w.label}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {/* TOTAL EXPENSES across every line, per week. */}
              <tr className="border-y-2 border-ink bg-brand-tint/40 font-bold">
                <td className="sticky left-0 z-10 bg-brand-tint/40 px-2 py-1.5 text-left">TOTAL EXPENSES</td>
                <Cells cells={data.total} weeks={weeks} bold />
              </tr>
              {data.depts.map((dept) =>
                dept.lines.map((line) => (
                  <FragmentLine key={`${dept.dept}|${line.line}`} dept={dept.dept} line={line} weeks={weeks} />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

function FragmentLine({ dept, line, weeks }) {
  return (
    <>
      {/* USALI line subtotal row (no department subtotal rows — they duplicate single-line depts). */}
      <tr className="bg-surface-muted font-semibold text-ink">
        <td className="sticky left-0 z-10 bg-surface-muted px-2 py-1 text-left">
          {line.line}
          <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-muted font-normal">{dept}</span>
        </td>
        <Cells cells={line.cells} weeks={weeks} bold />
      </tr>
      {line.vendors.map((v) => (
        <Vendor key={v.vendor} vendor={v} weeks={weeks} />
      ))}
    </>
  )
}

function Vendor({ vendor, weeks }) {
  return (
    <>
      <tr className="text-ink">
        <td className="sticky left-0 z-10 bg-white px-2 py-1 text-left pl-6 font-medium">
          {vendor.vendor}
          {vendor.label && <span className="ml-1.5 text-[11px] text-ink-muted font-normal">{vendor.label}</span>}
        </td>
        <Cells cells={vendor.cells} weeks={weeks} />
      </tr>
      {vendor.hotels.map((h) => (
        <tr key={h.hotel} className="text-ink-muted">
          <td className="sticky left-0 z-10 bg-white px-2 py-1 text-left pl-10 font-normal">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
              style={{ background: HOTEL_DOT[h.hotel] || '#8a8a8e' }}
            />
            {h.hotel}
            {h.pay_account && <span className="ml-2 text-[11px] text-line">{h.pay_account}</span>}
          </td>
          <Cells cells={h.cells} weeks={weeks} />
        </tr>
      ))}
    </>
  )
}
