export default function Banner({ tone = 'info', children }) {
  const toneClass = {
    info:    'bg-brand-tint text-brand border-brand/20',
    warn:    'bg-warning-tint text-warning border-warning/20',
    error:   'bg-danger-tint text-danger border-danger/20',
    success: 'bg-positive-tint text-positive border-positive/20',
  }[tone]
  return (
    <div className={`text-[14px] border rounded-lg px-3.5 py-2.5 ${toneClass}`}>{children}</div>
  )
}
