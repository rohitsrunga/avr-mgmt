import { useEffect, useMemo, useState } from 'react'
import Banner from './Banner'
import SectionCard from './SectionCard'
import { useApi } from '../hooks/useApi'

// USALI departmental P&L for one hotel, as a 12-month matrix for a year. Each
// cell carries a single best-estimate number per line:
//   • completed months   → QuickBooks actuals
//   • current month       → actuals MTD + forecast prorated over the days left
//   • upcoming months      → forecast (prior-year same month × current YTD trend)
// Each cell also shows the prior-year actual (PY) beneath the current figure.
// Actuals are ingested by scripts/qb_ingest_pnl.py; the forecast + the MTD
// blend are computed from the actual[]/forecast[]/prior[] series the API returns.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// All figures in $ thousands, 1 decimal (176700 → "176.7", 920 → "0.9").
const k = (n) =>
  n == null ? '—' : ((Number(n) || 0) / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function daysInMonth(year, mi) { return new Date(year, mi + 1, 0).getDate() }

const BASIS_LABEL = {
  pysm_ytd_trend: 'prior-year same month × current YTD trend',
  override: 'prior-year same month × manual Y/Y override',
  pysm_flat: 'prior-year same month (no YTD trend yet)',
  ytd_runrate: 'current-year run-rate (no prior-year data)',
  consolidated: 'consolidated · prior-year same month × YTD trend',
}
function forecastSubtitle(data) {
  const label = BASIS_LABEL[data.forecast_basis] || 'forecast'
  let pct = ''
  if (data.yoy_factor != null && data.forecast_basis !== 'ytd_runrate') {
    const d = (data.yoy_factor - 1) * 100
    pct = ` (${d >= 0 ? '+' : ''}${d.toFixed(1)}% Y/Y)`
  }
  const synced = data.synced_at ? ` · actuals synced ${new Date(data.synced_at).toLocaleDateString()}` : ''
  return `All figures in $ thousands · Forecast: ${label}${pct}${synced}`
}

export default function FinancePnL({ propertyIds, consolidated }) {
  const api = useApi()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Collapsed by default: only top-level rows show until a group is expanded.
  const [expanded, setExpanded] = useState(() => new Set())
  // Prior-year is hover-only by default to keep the grid uncluttered; toggles
  // surface PY inline and the CY/PY row labels.
  const [showPY, setShowPY] = useState(false)
  const [showLabels, setShowLabels] = useState(false)
  function toggleGroup(gid) {
    setExpanded((s) => { const n = new Set(s); n.has(gid) ? n.delete(gid) : n.add(gid); return n })
  }

  async function load() {
    setLoading(true); setError('')
    try {
      const list = await Promise.all(propertyIds.map((pid) => api.get(`/api/finance/${pid}/pnl`, { year })))
      setData(mergePnl(list))
    } catch (e) { setError(e.message); setData(null) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyIds.join(','), year])

  async function saveTaxRate(rate) {
    if (consolidated) return
    try {
      await api.put(`/api/finance/${propertyIds[0]}/assumptions`, { year, income_tax_rate: rate })
      load()
    } catch (e) { setError(e.message) }
  }

  async function saveCashOverride(month, accounts) {
    if (consolidated) return
    try {
      await api.put(`/api/finance/${propertyIds[0]}/cash-override`, { month, accounts })
      load()
    } catch (e) { setError(e.message) }
  }

  const rows = data?.rows || []
  const actualMonths = data?.actual_months || []
  const nameDetail = data?.name_detail || {}
  const allGroups = useMemo(() => {
    const g = rows.filter(isParent).map(groupOf)
    if (data?.cash) g.unshift('cash')
    return g
  }, [rows, data])
  const allExpanded = allGroups.length > 0 && allGroups.every((g) => expanded.has(g))

  const yearOptions = useMemo(() => {
    const y = now.getFullYear()
    return [y + 1, y, y - 1, y - 2]
  }, [])

  // Per-month blend recipe: how much of each line is real (actual) vs forecast,
  // and what the cell represents. Computed once per year, applied to every row.
  const curY = now.getFullYear()
  const curM = now.getMonth()
  const monthMeta = useMemo(() => {
    return MONTHS.map((_, mi) => {
      const ym = `${year}-${String(mi + 1).padStart(2, '0')}`
      const hasActual = actualMonths.includes(ym)
      const isPast = year < curY || (year === curY && mi < curM)
      const isCurrent = year === curY && mi === curM
      // A past month with no booked actuals is a data gap (blank), not a
      // forecast — forecast only fills the current and future months.
      if (isPast) return hasActual ? { part: true, frac: 0, kind: 'actual' } : { part: false, frac: 0, kind: 'gap' }
      if (isCurrent) {
        if (!hasActual) return { part: false, frac: 1, kind: 'forecast' }
        const dim = daysInMonth(year, mi)
        return { part: true, frac: Math.max(0, (dim - now.getDate()) / dim), kind: 'mtd' }
      }
      return { part: false, frac: 1, kind: 'forecast' }
    })
  }, [year, actualMonths, curY, curM])

  function cellValue(row, mi) {
    const m = monthMeta[mi]
    if (m.kind === 'gap') return null // unbooked past month → blank
    const a = m.part ? (row.actual?.[mi] || 0) : 0
    const f = (row.forecast?.[mi] || 0) * m.frac
    if (!m.part && !row.forecast) return null
    return a + f
  }
  function rowTotal(row) {
    let sum = 0; let any = false
    for (let mi = 0; mi < 12; mi++) {
      const v = cellValue(row, mi)
      if (v != null) { sum += v; any = true }
    }
    return any ? sum : null
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="select min-h-0 py-1.5 text-[13px] w-auto"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-ink-muted mr-0.5">Show</span>
          <Chip active={showPY} onClick={() => setShowPY((v) => !v)}>Prior yr</Chip>
          <Chip active={showLabels} onClick={() => setShowLabels((v) => !v)}>Labels</Chip>
          <button
            className="btn-secondary px-3 py-1.5 text-[13px]"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(allGroups))}
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {data?.cash && (
        <CashCard cash={data.cash} year={year} curY={curY} curM={curM}
          showPY={showPY} showLabels={showLabels}
          expanded={expanded.has('cash')} onToggle={() => toggleGroup('cash')}
          consolidated={consolidated} onSaveTax={saveTaxRate} onSaveOverride={saveCashOverride} />
      )}

      <SectionCard
        title={`Budget Estimation · ${year}`}
        subtitle={data ? forecastSubtitle(data) : ''}
      >
        {loading ? (
          <div className="text-[14px] text-ink-muted py-10 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-[14px] text-ink-muted py-10 text-center">No budget data yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="text-[12px] border-collapse">
                <thead>
                  <tr className="text-ink-muted text-[10px] uppercase tracking-[0.04em]">
                    <th className="sticky left-0 bg-white text-left font-medium py-2 pr-3 z-10 min-w-[150px]">Line</th>
                    {MONTHS.map((m, mi) => (
                      <th key={m} className={`text-right font-medium py-2 px-2 tabular-nums min-w-[58px] ${
                        year === curY && mi === curM ? 'text-brand' : ''
                      }`}>{m}</th>
                    ))}
                    <th className="text-right font-semibold py-2 pl-3 pr-1 tabular-nums min-w-[64px] text-ink">Year</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.flatMap((r, i) => {
                    const vis = groupOf(r)
                    if (isChild(r) && !expanded.has(vis)) return []
                    const curCol = year === curY ? curM : -1
                    const detailKey = detailKeyFor(r)
                    const names = detailKey ? nameDetail[detailKey] : null
                    const hasNames = names && Object.keys(names).length > 0
                    const parentToggle = isParent(r)
                    const expandable = parentToggle || hasNames
                    const gid = parentToggle ? vis : (hasNames ? `name:${detailKey}` : null)
                    const isOpen = expandable && expanded.has(gid)
                    const out = [
                      <PnlRow key={`${r.label}-${i}`} row={r} monthMeta={monthMeta}
                        cellValue={cellValue} total={rowTotal(r)} curCol={curCol}
                        expandable={expandable} expanded={isOpen} showPY={showPY} showLabels={showLabels}
                        onToggle={expandable ? () => toggleGroup(gid) : undefined} />,
                    ]
                    if (hasNames && isOpen) {
                      const lvl = (r.level || 0) + 1
                      Object.entries(names)
                        .sort((a, b) => Math.abs(sum12(b[1]) || 0) - Math.abs(sum12(a[1]) || 0))
                        .forEach(([nm, vals]) => out.push(
                          <NameRow key={`${r.label}-${i}-${nm}`} name={nm} values={vals} level={lvl} curCol={curCol} />))
                      const other = otherResidual(r, names)
                      if (other.some((v) => v != null && Math.abs(v) >= 0.05))
                        out.push(<NameRow key={`${r.label}-${i}-other`} name="Other (< $1K)" values={other} level={lvl} curCol={curCol} muted />)
                    }
                    return out
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-ink-muted mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <span>Hover a cell for prior-year (PY); use <span className="font-medium">Show › Prior yr</span> to pin it</span>
              <span><span className="text-ink-body font-medium">Dark</span> = actuals</span>
              <span><span className="text-brand font-medium">Brand</span> = current month (MTD + forecast)</span>
              <span><span className="italic text-ink-muted">Italic</span> = forecast</span>
              <span>Expand a line to see vendors/groups ≥ $1K (actuals).</span>
            </p>
          </>
        )}
      </SectionCard>
    </div>
  )
}

// Cash in Bank — month-end balances (actual) rolled forward as a forecast.
// A balance, not a flow: the "Year-end" column is December's balance, not a sum.
function CashCard({ cash, year, curY, curM, showPY, showLabels, expanded, onToggle, consolidated, onSaveTax, onSaveOverride }) {
  const curCol = year === curY ? curM : -1
  const isActual = (mi) => cash.actual_months?.includes(`${year}-${String(mi + 1).padStart(2, '0')}`)
  const [rate, setRate] = useState(cash.tax_rate ?? 25)
  useEffect(() => { setRate(cash.tax_rate ?? 25) }, [cash.tax_rate])
  const [editing, setEditing] = useState(false)
  const [editCell, setEditCell] = useState(null) // `${name}:${monthIdx}`
  const editable = !consolidated

  // Save a single inline cell as a per-account month override, merging with any
  // other overrides already set for that month so they're preserved.
  function saveCell(name, mi, num) {
    const ym = `${year}-${String(mi + 1).padStart(2, '0')}`
    const merged = { ...(cash.overrides?.[ym] || {}) }
    if (num == null) delete merged[name]
    else merged[name] = num
    onSaveOverride(ym, merged)
  }
  function commitCell(name, mi, raw, effective) {
    setEditCell(null)
    const ym = `${year}-${String(mi + 1).padStart(2, '0')}`
    const hadOverride = cash.overrides?.[ym]?.[name] != null
    const num = raw.trim() === '' ? null : Number(raw)
    if (num != null && Number.isNaN(num)) return
    if (num == null && !hadOverride) return     // nothing to clear
    if (num != null && num === effective) return // unchanged
    saveCell(name, mi, num)
  }

  // Account names that carry an owner override in any month this year.
  const overriddenNames = new Set()
  for (const m of Object.values(cash.overrides || {})) for (const n of Object.keys(m)) overriddenNames.add(n)

  const accounts = Object.entries(cash.accounts || {})
    .sort((a, b) => Math.abs(sum12(b[1]) || 0) - Math.abs(sum12(a[1]) || 0))

  function totalCell(mi) {
    const v = cash.total?.[mi]
    const tone = isActual(mi) ? 'text-ink' : 'text-ink-muted italic'
    return (
      <td key={mi} title={showPY ? undefined : `PY ${k(cash.prior?.[mi])}`}
        className={`text-right py-1.5 px-2 tabular-nums whitespace-nowrap align-top leading-tight font-medium ${tone} ${mi === curCol ? 'bg-brand-tint/40' : ''}`}>
        <div>{showLabels && <span className="text-[8px] text-ink-muted font-normal not-italic mr-0.5">CY</span>}{k(v)}</div>
        {showPY && <div className="text-[10px] text-ink-muted font-normal not-italic">{showLabels && <span className="text-[8px] mr-0.5">PY</span>}{k(cash.prior?.[mi])}</div>}
      </td>
    )
  }

  return (
    <SectionCard
      title="Cash in Bank"
      subtitle={consolidated
        ? 'All hotels · forecast rolls forward each hotel’s balance by net of estimated tax'
        : 'Month-end balances; forecast = prior balance + net result − estimated income tax'}
      actions={!consolidated && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            Income tax
            <input type="number" className="input py-1 w-16 text-right text-[13px]" value={rate}
              onChange={(e) => setRate(e.target.value)}
              onBlur={() => onSaveTax(Number(rate) || 0)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />%
          </label>
          <button className="btn-secondary px-3 py-1.5 text-[13px]" onClick={() => setEditing(true)}>Edit balances</button>
        </div>
      )}
    >
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="text-[12px] border-collapse">
          <thead>
            <tr className="text-ink-muted text-[10px] uppercase tracking-[0.04em]">
              <th className="sticky left-0 bg-white text-left font-medium py-2 pr-3 z-10 min-w-[150px]">Account</th>
              {MONTHS.map((m, mi) => (
                <th key={m} className={`text-right font-medium py-2 px-2 min-w-[58px] ${mi === curCol ? 'text-brand' : ''}`}>{m}</th>
              ))}
              <th className="text-right font-semibold py-2 pl-3 pr-1 min-w-[64px] text-ink">Year-end</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-surface-soft border-t border-line">
              <td className="sticky left-0 bg-surface-soft py-1.5 pr-3 z-10 whitespace-nowrap font-semibold text-ink cursor-pointer select-none" onClick={onToggle}>
                <Chevron expanded={expanded} />Cash in Bank
              </td>
              {MONTHS.map((_, mi) => totalCell(mi))}
              <td className="text-right py-1.5 pl-3 pr-1 tabular-nums whitespace-nowrap font-semibold text-ink">{k(cash.total?.[11])}</td>
            </tr>
            {expanded && accounts.map(([name, vals]) => (
              <tr key={name}>
                <td className="sticky left-0 bg-white py-1 pr-3 z-10 whitespace-nowrap text-[11px] text-ink-muted" style={{ paddingLeft: '2rem' }}>
                  <span className="inline-block w-3 mr-1.5" />{name}
                  {overriddenNames.has(name) && <span className="ml-2 text-[9px] text-brand" title="manual override applied">✎ adj</span>}
                </td>
                {vals.map((v, mi) => {
                  const canEdit = editable // any month, even gaps with no QB data
                  const key = `${name}:${mi}`
                  if (editCell === key) {
                    return (
                      <td key={mi} className="px-1 py-0.5">
                        <input autoFocus inputMode="decimal"
                          className="input py-0.5 px-1 text-right text-[11px] w-full min-w-[52px]"
                          defaultValue={v == null ? '' : Math.round(v)}
                          onBlur={(e) => commitCell(name, mi, e.target.value, v)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                            if (e.key === 'Escape') setEditCell(null)
                          }} />
                      </td>
                    )
                  }
                  return (
                    <td key={mi} onClick={() => canEdit && setEditCell(key)}
                      className={`text-right py-1 px-2 tabular-nums text-[11px] whitespace-nowrap text-ink-body ${mi === curCol ? 'bg-brand-tint/40' : ''} ${canEdit ? 'cursor-pointer hover:bg-brand-tint/30' : ''}`}>
                      {v == null ? '' : k(v)}
                    </td>
                  )
                })}
                <td className="text-right py-1 pl-3 pr-1 tabular-nums text-[11px] whitespace-nowrap text-ink-body font-medium">{k(vals[11] != null ? vals[11] : [...vals].reverse().find((x) => x != null) ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-muted mt-2">
        All figures in $ thousands · drill in for per-account balances · italic = forecast · ✎ adj = manual override
        {editable && <> · <span className="text-ink-body">click an account balance to edit it</span> (enter dollars; blank reverts to QB)</>}
      </p>
      {editing && (
        <CashOverrideModal cash={cash} year={year}
          onClose={() => setEditing(false)}
          onSave={(m, a) => { onSaveOverride(m, a); setEditing(false) }} />
      )}
    </SectionCard>
  )
}

// Owner enters the true month-end balance per bank account, overriding QB's
// book balance (QB's API only exposes the book balance, which lags when
// bank-feed deposits are recorded late). Blank = use the QB book figure.
function CashOverrideModal({ cash, year, onClose, onSave }) {
  const names = Array.from(new Set([
    ...Object.keys(cash.book || {}),
    ...Object.values(cash.overrides || {}).flatMap((m) => Object.keys(m)),
  ]))
  // Default to the latest month that has any book balance.
  const lastActual = (cash.actual_months || []).slice(-1)[0]
  const [monthIdx, setMonthIdx] = useState(lastActual ? Number(lastActual.slice(5, 7)) - 1 : new Date().getMonth())
  const ym = `${year}-${String(monthIdx + 1).padStart(2, '0')}`
  const [vals, setVals] = useState({})
  useEffect(() => {
    const ov = cash.overrides?.[ym] || {}
    setVals(Object.fromEntries(names.map((n) => [n, ov[n] != null ? String(ov[n]) : ''])))
    // eslint-disable-next-line
  }, [ym])

  function save() {
    const accounts = {}
    for (const [n, v] of Object.entries(vals)) if (v !== '') accounts[n] = Number(v) || 0
    onSave(ym, accounts)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-xl max-w-lg w-full max-h-[92vh] overflow-y-auto shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-line-subtle sticky top-0 bg-white z-10">
          <h2 className="section-title">Actual cash balances</h2>
          <p className="text-[13px] text-ink-muted mt-0.5">Override QB’s book balance with the true month-end balance. Leave blank to use QB.</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-[12px] uppercase tracking-[0.06em] text-ink-muted">Month</span>
            <select className="select min-h-0 py-1.5 text-[13px] w-auto" value={monthIdx} onChange={(e) => setMonthIdx(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m} {year}</option>)}
            </select>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-ink-muted text-[11px] uppercase">
                <th className="text-left py-1 pr-2 font-medium">Account</th>
                <th className="text-right py-1 px-2 font-medium">QB book</th>
                <th className="text-right py-1 pl-2 font-medium">Actual override ($)</th>
              </tr>
            </thead>
            <tbody>
              {names.map((n) => (
                <tr key={n}>
                  <td className="py-1 pr-2 text-ink-body">{n}</td>
                  <td className="py-1 px-2 text-right tabular-nums text-ink-muted">
                    {cash.book?.[n]?.[monthIdx] != null ? Number(cash.book[n][monthIdx]).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
                  </td>
                  <td className="py-1 pl-2">
                    <input className="input py-1 text-right text-[13px]" inputMode="decimal"
                      placeholder={cash.book?.[n]?.[monthIdx] != null ? String(Math.round(cash.book[n][monthIdx])) : ''}
                      value={vals[n] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [n]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-ink-muted">Enter whole dollars. Saved values feed the cash total and the forecast roll-forward.</p>
        </div>
        <div className="flex gap-2 justify-end px-6 pb-6">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save {MONTHS[monthIdx]} {year}</button>
        </div>
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[12px] font-medium ${active ? 'badge-brand' : 'bg-white border border-line text-ink-body hover:border-ink-muted'}`}>
      {children}
    </button>
  )
}

function Chevron({ expanded }) {
  return (
    <span
      className="inline-block w-3 mr-1.5 text-ink-muted font-semibold not-italic transition-transform duration-150"
      style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
    >
      ›
    </span>
  )
}

function PnlRow({ row, monthMeta, cellValue, total, curCol, expandable, expanded, onToggle, showPY, showLabels }) {
  const isSubtotal = row.kind === 'subtotal'
  const isHeader = row.kind === 'expense_header' || row.kind === 'revenue'
  const isMemoHeader = row.kind === 'memo_header'
  const isMemo = row.kind === 'memo_line' || isMemoHeader

  if (isMemoHeader) {
    return (
      <tr>
        <td colSpan={14} onClick={onToggle}
          className="sticky left-0 pt-4 pb-1 text-[10px] uppercase tracking-[0.06em] text-ink-muted border-t border-line-subtle cursor-pointer select-none">
          {expandable && <Chevron expanded={expanded} />}{row.label}
        </td>
      </tr>
    )
  }

  const indent = { paddingLeft: `${0.75 + (row.level || 0) * 1.25}rem` }
  const labelCls = [
    'sticky left-0 bg-white py-1.5 pr-3 z-10 whitespace-nowrap',
    isSubtotal ? 'font-semibold text-ink' : isHeader ? 'font-medium text-ink' : 'text-ink-body',
    isMemo ? 'text-ink-muted' : '',
    expandable ? 'cursor-pointer select-none' : '',
  ].join(' ')
  const rowCls = isSubtotal ? 'border-t border-line bg-surface-soft' : ''

  function numCls(mi) {
    const kind = monthMeta[mi].kind
    const base = 'text-right py-1.5 px-2 tabular-nums whitespace-nowrap'
    if (kind === 'gap') return `${base} text-ink-faint` // unbooked → "—"
    if (isSubtotal) return `${base} font-semibold ${kind === 'actual' || kind === 'mtd' ? 'text-ink' : 'text-ink-muted italic'}`
    if (kind === 'mtd') return `${base} text-brand`
    if (kind === 'forecast') return `${base} text-ink-muted italic`
    return `${base} text-ink-body` // actual
  }

  const priorTotal = sum12(row.prior)
  return (
    <tr className={rowCls}>
      <td className={labelCls} style={indent} onClick={onToggle}>
        {expandable ? <Chevron expanded={expanded} /> : <span className="inline-block w-3 mr-1.5" />}
        {row.label}
      </td>
      {MONTHS.map((m, mi) => (
        <td key={m} title={showPY ? undefined : `PY ${k(row.prior?.[mi])}`}
          className={`${numCls(mi)} align-top leading-tight ${mi === curCol ? 'bg-brand-tint/40' : ''}`}>
          <div>{showLabels && <span className="text-[8px] text-ink-muted font-normal not-italic mr-0.5">CY</span>}{k(cellValue(row, mi))}</div>
          {showPY && <div className="text-[10px] text-ink-muted font-normal not-italic">{showLabels && <span className="text-[8px] mr-0.5">PY</span>}{k(row.prior?.[mi])}</div>}
        </td>
      ))}
      <td title={showPY ? undefined : `PY ${k(priorTotal)}`}
        className="text-right py-1.5 pl-3 pr-1 tabular-nums whitespace-nowrap align-top leading-tight">
        <div className={`font-semibold ${isMemo ? 'text-ink-muted' : 'text-ink'}`}>{showLabels && <span className="text-[8px] text-ink-muted font-normal mr-0.5">CY</span>}{k(total)}</div>
        {showPY && <div className="text-[10px] text-ink-muted font-normal">{showLabels && <span className="text-[8px] mr-0.5">PY</span>}{k(priorTotal)}</div>}
      </td>
    </tr>
  )
}

function sum12(arr) {
  let s = 0, any = false
  for (const v of arr || []) if (v != null) { s += v; any = true }
  return any ? s : null
}

// Element-wise add of two 12-arrays; null only when both are null.
function addArr(a, b) {
  const out = []
  for (let i = 0; i < 12; i++) {
    const x = a?.[i], y = b?.[i]
    out[i] = x == null && y == null ? null : (x || 0) + (y || 0)
  }
  return out
}

// Consolidate one or more /pnl responses (All Hotels = straight sum, no
// inter-company elimination — those adjustments happen outside this app).
function mergePnl(list) {
  if (list.length === 1) return list[0]
  const base = list[0]
  const rows = base.rows.map((r, ri) => {
    const m = { ...r }
    for (const f of ['actual', 'budget', 'forecast', 'prior', 'variance'])
      m[f] = list.reduce((acc, d) => addArr(acc, d.rows[ri]?.[f]), Array(12).fill(null))
    return m
  })
  const name_detail = {}
  for (const d of list)
    for (const [key, names] of Object.entries(d.name_detail || {}))
      for (const [nm, vals] of Object.entries(names)) {
        name_detail[key] = name_detail[key] || {}
        name_detail[key][nm] = addArr(name_detail[key][nm], vals)
      }
  const cash = { total: Array(12).fill(null), prior: Array(12).fill(null), accounts: {}, actual_months: [], tax_rate: null }
  for (const d of list) {
    if (!d.cash) continue
    cash.total = addArr(cash.total, d.cash.total)
    cash.prior = addArr(cash.prior, d.cash.prior)
    for (const [nm, vals] of Object.entries(d.cash.accounts || {}))
      cash.accounts[nm] = addArr(cash.accounts[nm], vals)
    cash.actual_months = [...new Set([...cash.actual_months, ...(d.cash.actual_months || [])])]
  }
  const actual_months = [...new Set(list.flatMap((d) => d.actual_months || []))]
  return { ...base, rows, name_detail, cash, actual_months, forecast_basis: 'consolidated', yoy_factor: null }
}

// Collapsible grouping: a parent (revenue, each department, memo) owns the
// child lines that follow it. Subtotals belong to no group and always show.
const PARENT_KINDS = ['revenue', 'expense_header', 'memo_header']
const CHILD_KINDS = ['revenue_line', 'expense_line', 'memo_line']
function isParent(row) { return PARENT_KINDS.includes(row.kind) }
function isChild(row) { return CHILD_KINDS.includes(row.kind) }
function groupOf(row) {
  if (row.kind === 'revenue' || row.kind === 'revenue_line') return 'revenue'
  if (row.kind === 'memo_header' || row.kind === 'memo_line') return 'memo'
  if (row.kind === 'expense_header') return `dept:${row.label}`
  if (row.kind === 'expense_line') return `dept:${row.dept}`
  return null
}

// Third drill-down: which name_detail key (a QB line key) a row drills into.
function detailKeyFor(row) {
  if (row.kind === 'expense_line') return row.label
  if (row.kind === 'revenue_line') return row.label === 'Rooms' ? 'Room Rental Income' : 'Square Income'
  return null
}

// Per-month residual of an account's actuals not covered by the named (>$1K)
// vendors/groups — the sub-threshold remainder, shown as "Other (< $1K)".
function otherResidual(row, names) {
  const out = Array(12).fill(null)
  for (let mi = 0; mi < 12; mi++) {
    const a = row.actual?.[mi]
    if (a == null) continue
    let s = 0
    for (const vals of Object.values(names)) s += vals[mi] || 0
    out[mi] = a - s
  }
  return out
}

function NameRow({ name, values, level, curCol, muted }) {
  const total = sum12(values)
  const tone = muted ? 'text-ink-muted italic' : 'text-ink-body'
  return (
    <tr>
      <td className="sticky left-0 bg-white py-1 pr-3 z-10 whitespace-nowrap text-[11px] text-ink-muted"
        style={{ paddingLeft: `${0.75 + level * 1.25}rem` }}>
        <span className="inline-block w-3 mr-1.5" />
        <span className={muted ? 'italic' : ''}>{name}</span>
      </td>
      {values.map((v, mi) => (
        <td key={mi} className={`text-right py-1 px-2 tabular-nums text-[11px] whitespace-nowrap ${tone} ${mi === curCol ? 'bg-brand-tint/40' : ''}`}>
          {v == null ? '' : k(v)}
        </td>
      ))}
      <td className={`text-right py-1 pl-3 pr-1 tabular-nums text-[11px] whitespace-nowrap font-medium ${tone}`}>{k(total)}</td>
    </tr>
  )
}
