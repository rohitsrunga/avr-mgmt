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

export default function Inventory() {
  const api = useApi()
  const { user } = useAuth()
  const { propertyId, property } = useProperty()
  const isMgmt = MGMT.has(user?.role)
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
      setAllItems(all.items || [])
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
          <p className="page-subtitle">{property?.name} · {allItems.length} SKUs across {INVENTORY_CATEGORIES.length} categories. Walk, scan, restock.</p>
        </div>
        {isMgmt && (
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

      {showAdd && isMgmt && (
        <AddItemForm
          propertyId={propertyId}
          category={activeCategory === 'all' ? INVENTORY_CATEGORIES[0].id : activeCategory}
          vendors={vendors}
          onAdded={() => { setShowAdd(false); load() }}
        />
      )}

      <StockTable
        label={activeCategory === 'all' ? 'All items' : CATEGORY_MAP[activeCategory]?.label || 'Items'}
        items={filteredItems}
        isMgmt={isMgmt}
        vendors={vendors}
        onUpdate={updateField}
        onDelete={deleteItem}
      />

      <VendorPanel vendorSummary={vendorSummary} />
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
                <th className="w-24">Category</th>
                <th className="w-16">Unit</th>
                <th className="w-20 text-right">Current</th>
                <th className="w-16 text-right">Par</th>
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
                    <td className="text-ink">{item.item_name}</td>
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
                    <div className="text-[14px] font-medium text-ink">{item.item_name}</div>
                    {isMgmt && <button onClick={() => onDelete(item)} className="text-ink-muted text-[18px]">×</button>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <div className="label">Stock</div>
                      <input className="input" type="number" defaultValue={item.current_stock}
                        onBlur={(e) => Number(e.target.value) !== item.current_stock && onUpdate(item, 'current_stock', Number(e.target.value))} />
                    </div>
                    <div>
                      <div className="label">Par</div>
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
  const [par, setPar] = useState(0)
  const [unit, setUnit] = useState('each')
  const [vendor, setVendor] = useState('')
  const [cat, setCat] = useState(category)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.post(`/api/inventory/${propertyId}/items`, { category: cat, item_name: name, par_level: Number(par), unit, vendor })
      setName(''); setPar(0); setVendor('')
      onAdded?.()
    } finally { setBusy(false) }
  }

  return (
    <div className="card bg-surface-subtle">
      <h3 className="section-title mb-3">Add inventory item</h3>
      <div className="grid sm:grid-cols-[1fr,160px,100px,100px,160px,auto] gap-2">
        <input className="input" placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
          {INVENTORY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input className="input" placeholder="Par" type="number" value={par} onChange={(e) => setPar(e.target.value)} />
        <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option>each</option><option>box</option><option>case</option><option>bag</option>
        </select>
        <input className="input" list="inv-vendors-add" placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? '…' : 'Add'}</button>
      </div>
      <datalist id="inv-vendors-add">
        {vendors.map((v) => <option key={v} value={v} />)}
      </datalist>
    </div>
  )
}
