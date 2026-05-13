export default function EmptyState({ title, hint }) {
  return (
    <div className="card text-center py-12">
      <div className="text-[16px] font-medium text-ink mb-1">{title}</div>
      {hint && <div className="text-[14px] text-ink-muted">{hint}</div>}
    </div>
  )
}
