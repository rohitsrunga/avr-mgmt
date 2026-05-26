import { useState } from 'react'

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
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-ink-muted">{label}</div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-[14px] text-brand font-mono truncate block hover:underline"
        >
          {url}
        </a>
      </div>
      <button onClick={copy} className="btn-secondary text-[13px] px-3 py-1.5 min-h-0">
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}
