export default function StatCard({ label, value, hint, tone = 'neutral' }) {
  const toneClass = {
    neutral: 'text-ink',
    positive: 'text-positive',
    warning: 'text-warning',
    danger: 'text-danger',
    brand: 'text-brand',
  }[tone] || 'text-ink'
  return (
    <div className="card">
      <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">{label}</div>
      <div className={`text-[28px] font-semibold tracking-tight tabular-nums mt-2 ${toneClass}`}>
        {value ?? '—'}
      </div>
      {hint && <div className="text-[12px] text-ink-muted mt-1">{hint}</div>}
    </div>
  )
}
