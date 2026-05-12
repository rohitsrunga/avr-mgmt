export default function StockBar({ current, par }) {
  const pct = par > 0 ? Math.min(100, Math.round((current / par) * 100)) : 0
  const tone = pct >= 60 ? 'bg-accent-teal' : pct >= 30 ? 'bg-accent-amber' : 'bg-accent-red'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-ink-700 rounded overflow-hidden min-w-[60px]">
        <div className={`h-full ${tone}`} style={{ width: par > 0 ? `${pct}%` : '0%' }} />
      </div>
      <div className="text-xs font-mono text-text-secondary w-16 text-right tabular-nums">
        {current}/{par || '—'}
      </div>
    </div>
  )
}
