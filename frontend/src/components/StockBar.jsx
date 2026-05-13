export default function StockBar({ current, par }) {
  const pct = par > 0 ? Math.min(100, Math.round((current / par) * 100)) : 0
  const tone = pct >= 60 ? 'bg-positive' : pct >= 30 ? 'bg-warning' : 'bg-danger'
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 h-1.5 bg-surface-sunken rounded-full overflow-hidden min-w-[60px]">
        <div className={`h-full ${tone} rounded-full transition-all`} style={{ width: par > 0 ? `${pct}%` : '0%' }} />
      </div>
      <div className="text-[12px] text-ink-muted w-14 text-right tabular-nums">
        {current}/{par || '—'}
      </div>
    </div>
  )
}
