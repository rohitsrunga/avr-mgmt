import { useState } from 'react'

// A public-form share row. The raw URL is never shown — the form's name is
// the hyperlink, and the URL only leaves the app via "Copy link".
export default function CopyLink({ url, label }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }
  if (!url) return null
  return (
    <div className="card flex flex-wrap items-center gap-3">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex-1 min-w-0 text-[14px] font-medium text-brand hover:underline truncate"
        title={label}
      >
        {label} <span aria-hidden="true">↗</span>
      </a>
      <button onClick={copy} className="btn-secondary text-[13px] px-3 py-1.5 min-h-0">
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}
