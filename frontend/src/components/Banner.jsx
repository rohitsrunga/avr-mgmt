export default function Banner({ tone = 'info', children }) {
  const toneClass = {
    info: 'bg-accent-blue/10 text-accent-blue border-accent-blue/40',
    warn: 'bg-accent-amber/10 text-accent-amber border-accent-amber/40',
    error: 'bg-accent-red/10 text-accent-red border-accent-red/40',
    success: 'bg-accent-teal/10 text-accent-teal border-accent-teal/40',
  }[tone]
  return (
    <div className={`text-sm border rounded-md px-3 py-2 ${toneClass}`}>{children}</div>
  )
}
