export default function MetricCard({ label, value, sub }) {
  return (
    <div className="card">
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div className="text-[32px] sm:text-[34px] font-semibold tracking-tight leading-none mt-2 text-ink tabular-nums">
        {value}
      </div>
      {sub && <div className="text-[13px] text-ink-muted mt-2">{sub}</div>}
    </div>
  )
}
