export default function MetricCard({ label, value, sub, accent }) {
  const accentColor = {
    teal: 'text-accent-teal',
    amber: 'text-accent-amber',
    blue: 'text-accent-blue',
    red: 'text-accent-red',
  }[accent] || 'text-text-primary'

  return (
    <div className="card">
      <div className="tag mb-1">{label}</div>
      <div className={`text-3xl sm:text-4xl font-display font-semibold leading-none ${accentColor}`}>{value}</div>
      {sub && <div className="text-xs text-text-secondary mt-2">{sub}</div>}
    </div>
  )
}
