import { useEffect, useMemo, useState } from 'react'
import Banner from '../components/Banner'
import CopyLink from '../components/CopyLink'
import SectionCard from '../components/SectionCard'
import StockBar from '../components/StockBar'
import { CONFIG, INVENTORY_CATEGORIES } from '../config'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../auth/AuthProvider'
import { useProperty } from '../hooks/useProperty'

const MGMT = new Set(['owner', 'manager'])
const CATEGORY_MAP = Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c.id, c]))

// Colloquial unit label, pluralized for the count (e.g. 4 → "packs", 1 → "loaf").
const PLURALS = { loaf: 'loaves', box: 'boxes', bunch: 'bunches' }
function unitLabel(unit, n) {
  const u = !unit || unit === 'each' ? 'unit' : unit
  if (Number(n) === 1) return u
  return PLURALS[u] || `${u}s`
}

// Clickable product name → Sam's Club page when the item carries a SKU/url.
function ItemName({ item, className = '' }) {
  if (item.url) {
    return (
      <a href={item.url} target="_blank" rel="noopener noreferrer"
        className={`text-brand hover:underline ${className}`} title="Open Sam's Club product page">
        {item.item_name}
      </a>
    )
  }
  return <span className={className}>{item.item_name}</span>
}

export default function Inventory() {
  const api = useApi()
  const { user } = useAuth()
  const { propertyId, property } = useProperty()
  const isMgmt = MGMT.has(user?.role)
  const [mode, setMode] = useState('count') // 'count' (walk & count) | 'manage'
  const [activeCategory, setActiveCategory] = useState('all') // 'all' or category id
  const [allItems, setAllItems] = useState([])
  const [vendors, setVendors] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setError('')
      const [all, vend] = await Promise.all([
        api.get(`/api/inventory/${propertyId}`).catch(() => ({ items: [] })),
        api.get(`/api/inventory/${propertyId}/vendors`).catch(() => ({ vendors: [] })),
      ])
      // Only show categories surfaced in the UI — legacy linen/amenity/front_desk
      // rows may still exist in the table but are no longer tracked here.
      setAllItems((all.items || []).filter((it) => CATEGORY_MAP[it.category]))
      setVendors(vend.vendors || [])
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyId])

  async function updateField(item, field, value) {
    setAllItems((arr) => arr.map((it) => it.item_id === item.item_id ? { ...it, [field]: value } : it))
    try {
      await api.put(`/api/inventory/${propertyId}/items/${item.item_id}`, { category: item.category, [field]: value })
      load()
    } catch (e) { setError(e.message); load() }
  }

  async function deleteItem(item) {
    if (!confirm(`Delete "${item.item_name}"?`)) return
    try {
      await api.del(`/api/inventory/${propertyId}/items/${item.item_id}`, { category: item.category })
      load()
    } catch (e) { setError(e.message) }
  }

  // Bulk save the walk & count draft in one request.
  async function saveCounts(updates) {
    try {
      await api.post(`/api/inventory/${propertyId}/items/bulk-update`, { updates, change_type: 'stock_check' })
      await load()
    } catch (e) { setError(e.message) }
  }

  const counts = useMemo(() => {
    const byCat = { all: allItems.length }
    INVENTORY_CATEGORIES.forEach((c) => { byCat[c.id] = 0 })
    allItems.forEach((it) => { if (byCat[it.category] != null) byCat[it.category] += 1 })
    return byCat
  }, [allItems])

  const filteredItems = useMemo(() => {
    if (activeCategory === 'all') return allItems
    return allItems.filter((i) => i.category === activeCategory)
  }, [allItems, activeCategory])

  const vendorSummary = useMemo(() => {
    const map = new Map()
    vendors.forEach((v) => map.set(v, { name: v, items: 0, due: 0 }))
    allItems.forEach((it) => {
      const v = it.vendor || '—'
      if (!map.has(v)) map.set(v, { name: v, items: 0, due: 0 })
      const row = map.get(v)
      row.items += 1
      if (it.status === 'critical' || it.status === 'low') row.due += 1
    })
    return Array.from(map.values()).sort((a, b) => b.items - a.items)
  }, [allItems, vendors])

  const formUrl = CONFIG.publicFormsBaseUrl ? `${CONFIG.publicFormsBaseUrl}/inventory.html?p=${propertyId}` : ''

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">{property?.name} · {allItems.length} SKUs across {INVENTORY_CATEGORIES.length} categories. Walk, count, reorder.</p>
        </div>
        <div className="flex rounded-full bg-surface-muted border border-line-subtle p-0.5">
          <button onClick={() => setMode('count')} className={`px-3.5 py-1.5 text-[13px] rounded-full transition ${mode === 'count' ? 'bg-surface shadow-sm text-ink font-medium' : 'text-ink-muted'}`}>Count</button>
          <button onClick={() => setMode('manage')} className={`px-3.5 py-1.5 text-[13px] rounded-full transition ${mode === 'manage' ? 'bg-surface shadow-sm text-ink font-medium' : 'text-ink-muted'}`}>Manage</button>
        </div>
        {isMgmt && mode === 'manage' && (
          <button onClick={() => setShowAdd((s) => !s)} className="btn-secondary">
            {showAdd ? 'Cancel' : 'Add item'}
          </button>
        )}
      </div>

      {formUrl && <CopyLink url={formUrl} label="Stock-check public form" />}
      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setActiveCategory('all')} className={`chip ${activeCategory === 'all' ? 'active' : ''}`}>
          All · {counts.all}
        </button>
        {INVENTORY_CATEGORIES.map((c) => (
          <button key={c.id} onClick={() => setActiveCategory(c.id)} className={`chip ${activeCategory === c.id ? 'active' : ''}`}>
            {c.label} · {counts[c.id] || 0}
          </button>
        ))}
      </div>

      {showAdd && isMgmt && mode === 'manage' && (
        <AddItemForm
          propertyId={propertyId}
          category={activeCategory === 'all' ? INVENTORY_CATEGORIES[0].id : activeCategory}
          vendors={vendors}
          onAdded={() => { setShowAdd(false); load() }}
        />
      )}

      {mode === 'count' ? (
        <CountSheet items={filteredItems} activeCategory={activeCategory} onSave={saveCounts} />
      ) : (
        <StockTable
          label={activeCategory === 'all' ? 'All items' : CATEGORY_MAP[activeCategory]?.label || 'Items'}
          items={filteredItems}
          isMgmt={isMgmt}
          vendors={vendors}
          onUpdate={updateField}
          onDelete={deleteItem}
        />
      )}

      <VendorPanel vendorSummary={vendorSummary} />
    </div>
  )
}

// ── Walk & count: big steppers grouped by category, one bulk save ──────────
function CountSheet({ items, activeCategory, onSave }) {
  const [draft, setDraft] = useState({}) // item_id -> count (only dirty entries)
  const [saving, setSaving] = useState(false)

  // Drop drafts that the latest server load already reflects.
  useEffect(() => {
    setDraft((d) => {
      const next = {}
      for (const it of items) {
        if (d[it.item_id] != null && d[it.item_id] !== it.current_stock) next[it.item_id] = d[it.item_id]
      }
      return next
    })
  }, [items])

  const valueFor = (it) => (draft[it.item_id] != null ? draft[it.item_id] : it.current_stock)
  const setValue = (it, v) => setDraft((d) => ({ ...d, [it.item_id]: Math.max(0, v) }))

  const dirty = useMemo(() => {
    return items
      .filter((it) => draft[it.item_id] != null && draft[it.item_id] !== it.current_stock)
      .map((it) => ({ item_id: it.item_id, category: it.category, current_stock: draft[it.item_id] }))
  }, [items, draft])

  // Group by category when viewing all; otherwise a single flat group.
  const groups = useMemo(() => {
    if (activeCategory !== 'all') return [{ id: activeCategory, label: CATEGORY_MAP[activeCategory]?.label, items }]
    return INVENTORY_CATEGORIES
      .map((c) => ({ id: c.id, label: c.label, items: items.filter((i) => i.category === c.id) }))
      .filter((g) => g.items.length > 0)
  }, [items, activeCategory])

  async function save() {
    if (!dirty.length) return
    setSaving(true)
    try { await onSave(dirty); setDraft({}) } finally { setSaving(false) }
  }

  if (items.length === 0) {
    return <SectionCard title="Walk & count"><div className="text-[14px] text-ink-muted py-10 text-center">No items.</div></SectionCard>
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <SectionCard key={g.id} title={g.label}
          actions={<span className="text-[11px] text-ink-muted">{g.items.length} item{g.items.length === 1 ? '' : 's'}</span>}>
          <div className="divide-y divide-line-subtle">
            {g.items.map((it) => {
              const val = valueFor(it)
              const status = it.status || 'ok'
              const isDirty = draft[it.item_id] != null && draft[it.item_id] !== it.current_stock
              const dot = status === 'critical' ? 'bg-danger' : status === 'low' ? 'bg-warning' : 'bg-emerald-400'
              return (
                <div key={`${it.category}#${it.item_id}`} className="flex items-center gap-3 py-2.5">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} title={status} />
                  <div className="min-w-0 flex-1">
                    <ItemName item={it} className="text-[14px] font-medium" />
                    <div className="text-[11px] text-ink-muted">
                      Typical inventory: {it.par_level} {unitLabel(it.unit, it.par_level)}{it.sku ? ` · #${it.sku}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => setValue(it, val - 1)}
                      className="h-9 w-9 rounded-full border border-line text-ink-body text-[20px] leading-none active:scale-95 disabled:opacity-30"
                      disabled={val <= 0} aria-label="decrease">−</button>
                    <input type="number" inputMode="numeric" value={val}
                      onChange={(e) => setValue(it, Number(e.target.value))}
                      className={`input w-14 text-center px-1 py-1.5 min-h-0 text-[15px] font-semibold ${isDirty ? 'ring-2 ring-brand/40' : ''}`} />
                    <button onClick={() => setValue(it, val + 1)}
                      className="h-9 w-9 rounded-full border border-line text-ink-body text-[20px] leading-none active:scale-95"
                      aria-label="increase">+</button>
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      ))}

      {/* Sticky save bar — only when there are uncounted changes. */}
      {dirty.length > 0 && (
        <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 card shadow-lg bg-surface border-brand/30">
          <span className="text-[13px] text-ink-body">{dirty.length} count{dirty.length === 1 ? '' : 's'} changed</span>
          <div className="flex gap-2">
            <button onClick={() => setDraft({})} className="btn-secondary" disabled={saving}>Discard</button>
            <button onClick={save} className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save counts'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function StockTable({ label, items, isMgmt, vendors, onUpdate, onDelete }) {
  return (
    <SectionCard
      title={label}
      actions={<span className="text-[11px] text-ink-muted">{items.length} item{items.length === 1 ? '' : 's'}</span>}
    >
      {items.length === 0 ? (
        <div className="text-[14px] text-ink-muted py-10 text-center">No items.</div>
      ) : (
        <div className="overflow-x-auto -m-2 p-2">
          <table className="table-clean text-[13px] hidden md:table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="w-24">SKU</th>
                <th className="w-24">Category</th>
                <th className="w-16">Unit</th>
                <th className="w-20 text-right">On hand</th>
                <th className="w-16 text-right">Typical</th>
                <th className="w-32 pl-4">Level</th>
                <th className="w-32 text-right">Vendor</th>
                {isMgmt && <th className="w-8"></th>}
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 60).map((item) => {
                const status = item.status || 'ok'
                const cat = CATEGORY_MAP[item.category]?.label || item.category
                const tone = status === 'critical' ? 'bg-danger-tint/40' : status === 'low' ? 'bg-warning-tint/30' : ''
                return (
                  <tr key={`${item.category}#${item.item_id}`} className={tone}>
                    <td className="text-ink"><ItemName item={item} /></td>
                    <td className="text-ink-muted text-[12px] tabular-nums">{item.sku || '—'}</td>
                    <td className="text-ink-muted text-[12px]">{cat}</td>
                    <td className="text-ink-muted text-[12px]">{item.unit}</td>
                    <td className="text-right">
                      <input className="input w-16 text-center px-1 py-1 min-h-0 text-[13px]" type="number"
                        defaultValue={item.current_stock}
                        onBlur={(e) => Number(e.target.value) !== item.current_stock && onUpdate(item, 'current_stock', Number(e.target.value))} />
                    </td>
                    <td className="text-right">
                      <input className="input w-14 text-center px-1 py-1 min-h-0 text-[13px]" type="number"
                        defaultValue={item.par_level} disabled={!isMgmt}
                        onBlur={(e) => Number(e.target.value) !== item.par_level && onUpdate(item, 'par_level', Number(e.target.value))} />
                    </td>
                    <td className="pl-4"><div className="w-24"><StockBar current={item.current_stock} par={item.par_level} /></div></td>
                    <td className="text-right">
                      <input className="input min-h-0 py-1 text-[12px]" list="inv-vendors"
                        defaultValue={item.vendor || ''}
                        onBlur={(e) => e.target.value !== (item.vendor || '') && onUpdate(item, 'vendor', e.target.value)} />
                    </td>
                    {isMgmt && (
                      <td className="text-right">
                        <button onClick={() => onDelete(item)} className="text-ink-muted hover:text-danger text-[16px]">×</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-line-subtle">
            {items.slice(0, 60).map((item) => {
              const status = item.status || 'ok'
              const tone = status === 'critical' ? 'bg-danger-tint/40' : status === 'low' ? 'bg-warning-tint/30' : ''
              return (
                <div key={`${item.category}#${item.item_id}`} className={`py-3 ${tone}`}>
                  <div className="flex justify-between">
                    <div className="text-[14px] font-medium text-ink">
                      <ItemName item={item} />
                      {item.sku && <span className="text-[10px] text-ink-muted ml-1.5">#{item.sku}</span>}
                    </div>
                    {isMgmt && <button onClick={() => onDelete(item)} className="text-ink-muted text-[18px]">×</button>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <div className="label">On hand</div>
                      <input className="input" type="number" defaultValue={item.current_stock}
                        onBlur={(e) => Number(e.target.value) !== item.current_stock && onUpdate(item, 'current_stock', Number(e.target.value))} />
                    </div>
                    <div>
                      <div className="label">Typical</div>
                      <input className="input" type="number" defaultValue={item.par_level} disabled={!isMgmt}
                        onBlur={(e) => Number(e.target.value) !== item.par_level && onUpdate(item, 'par_level', Number(e.target.value))} />
                    </div>
                  </div>
                  <div className="mt-2"><StockBar current={item.current_stock} par={item.par_level} /></div>
                </div>
              )
            })}
          </div>

          {items.length > 60 && (
            <div className="text-[11px] text-ink-muted text-center mt-3">
              Showing first 60 of {items.length} · filter by category for the rest
            </div>
          )}
          <datalist id="inv-vendors">
            {vendors.map((v) => <option key={v} value={v} />)}
          </datalist>
        </div>
      )}
    </SectionCard>
  )
}

function VendorPanel({ vendorSummary }) {
  return (
    <SectionCard title="Vendors" actions={<span className="text-[11px] text-ink-muted">{vendorSummary.length} known</span>}>
      {vendorSummary.length === 0 ? (
        <div className="text-[13px] text-ink-muted py-6 text-center">No vendors yet.</div>
      ) : (
        <div className="space-y-2.5 text-[12px]">
          {vendorSummary.slice(0, 8).map((v) => (
            <div key={v.name} className="flex items-center justify-between border-b border-line-subtle pb-2 last:border-b-0">
              <div className="min-w-0">
                <div className="font-medium text-ink truncate">{v.name}</div>
                <div className="text-[10px] text-ink-muted">{v.items} SKU{v.items === 1 ? '' : 's'} tracked</div>
              </div>
              {v.due > 0 ? (
                <span className="pill bg-warning-tint text-warning">{v.due} due</span>
              ) : (
                <span className="pill bg-surface-muted text-ink-body border border-line-subtle">—</span>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function AddItemForm({ propertyId, category, vendors, onAdded }) {
  const api = useApi()
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [par, setPar] = useState(0)
  const [unit, setUnit] = useState('each')
  const [vendor, setVendor] = useState('')
  const [cat, setCat] = useState(category)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.post(`/api/inventory/${propertyId}/items`, { category: cat, item_name: name, sku: sku.trim(), par_level: Number(par), unit, vendor })
      setName(''); setSku(''); setPar(0); setVendor('')
      onAdded?.()
    } finally { setBusy(false) }
  }

  return (
    <div className="card bg-surface-subtle">
      <h3 className="section-title mb-3">Add inventory item</h3>
      <div className="grid sm:grid-cols-[1fr,140px,140px,90px,90px,150px,auto] gap-2">
        <input className="input" placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Sam's Club SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
          {INVENTORY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input className="input" placeholder="Typical qty" type="number" value={par} onChange={(e) => setPar(e.target.value)} />
        <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option>each</option><option>pack</option><option>box</option><option>case</option><option>bag</option><option>loaf</option>
        </select>
        <input className="input" list="inv-vendors-add" placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? '…' : 'Add'}</button>
      </div>
      {name.trim() && <p className="text-[11px] text-ink-muted mt-2">Links to a Sam's Club search for “{name.trim()}”</p>}
      <datalist id="inv-vendors-add">
        {vendors.map((v) => <option key={v} value={v} />)}
      </datalist>
    </div>
  )
}
