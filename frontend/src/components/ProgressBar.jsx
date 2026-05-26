export default function ProgressBar({ value = 0, max = 100, tone = 'brand', showLabel = false, className = '' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  const fill = {
    brand: 'bg-brand',
    positive: 'bg-positive',
    warning: 'bg-warning',
    danger: 'bg-danger',
  }[tone] || 'bg-brand'
  return (
    <div className={className}>
      {showLabel && (
        <div className="flex justify-between text-[12px] text-ink-muted mb-1 tabular-nums">
          <span>{value}</span>
          <span>{max}</span>
        </div>
      )}
      <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
        <div className={`h-full ${fill} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
