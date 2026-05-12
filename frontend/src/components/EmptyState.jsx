export default function EmptyState({ title, hint }) {
  return (
    <div className="card text-center py-10">
      <div className="font-display text-lg text-text-secondary mb-1">{title}</div>
      {hint && <div className="text-sm text-text-muted">{hint}</div>}
    </div>
  )
}
