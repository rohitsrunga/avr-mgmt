import { useEffect, useState } from 'react'
import Banner from '../components/Banner'
import StockBar from '../components/StockBar'
import { INVENTORY_CATEGORIES } from '../config'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../auth/AuthProvider'
import { useProperty } from '../hooks/useProperty'

const MGMT = ['owner', 'manager']

export default function Inventory() {
  const api = useApi()
  const { user } = useAuth()
  const { propertyId } = useProperty()
  const [category, setCategory] = useState(INVENTORY_CATEGORIES[0].id)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const isMgmt = MGMT.includes(user?.role)

  async function load() {
    try {
      setError('')
      const res = await api.get(`/api/inventory/${propertyId}`, { category })
      setItems(res.items || [])
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [propertyId, category])

  async function updateField(item, field, value) {
    const updated = { ...item, [field]: value }
    setItems((arr) => arr.map((it) => it.item_id === item.item_id ? updated : it))
    try {
      await api.put(`/api/inventory/${propertyId}/items/${item.item_id}`, {
        category, [field]: typeof value === 'number' ? value : Number(value),
      })
    } catch (e) {
      setError(e.message)
      load()
    }
  }

  async function deleteItem(item) {
    if (!confirm(`Delete "${item.item_name}"?`)) return
    try {
      await api.del(`/api/inventory/${propertyId}/items/${item.item_id}`, { category })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">Stock counts, par levels, and weekly linen counts.</p>
        </div>
        {isMgmt && (
          <button onClick={() => setShowAdd((s) => !s)} className="btn-secondary">
            {showAdd ? 'Cancel' : 'Add item'}
          </button>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {INVENTORY_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`px-3.5 py-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-all ${
              category === c.id
                ? 'bg-ink text-white'
                : 'bg-white text-ink-body border border-line-subtle hover:border-line'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {showAdd && isMgmt && (
        <AddItemForm
          propertyId={propertyId}
          category={category}
          onAdded={() => { setShowAdd(false); load() }}
        />
      )}

      {items.length === 0 ? (
        <div className="card text-center py-12 text-ink-muted text-[14px]">No items in this category yet.</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="table-clean hidden md:table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="w-36">Stock / Par</th>
                <th className="w-52">Fill</th>
                <th className="w-44">Last update</th>
                {isMgmt && <th className="w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const low = item.par_level > 0 && item.current_stock / item.par_level < 0.2
                return (
                  <tr key={item.item_id} className={low ? 'bg-danger-tint/40' : ''}>
                    <td>
                      <div className="text-ink text-[14px]">{item.item_name}</div>
                      <div className="text-[12px] text-ink-muted">{item.unit}</div>
                    </td>
                    <td>
                      <div className="flex gap-1.5 items-center">
                        <input className="input w-16 text-center px-1.5 py-1.5 min-h-0" type="number" defaultValue={item.current_stock}
                          onBlur={(e) => updateField(item, 'current_stock', Number(e.target.value))} />
                        <span className="text-ink-muted">/</span>
                        <input className="input w-16 text-center px-1.5 py-1.5 min-h-0" type="number" defaultValue={item.par_level}
                          onBlur={(e) => updateField(item, 'par_level', Number(e.target.value))}
                          disabled={!isMgmt} />
                      </div>
                    </td>
                    <td><StockBar current={item.current_stock} par={item.par_level} /></td>
                    <td className="text-[12px] text-ink-muted">
                      {item.last_updated ? new Date(item.last_updated).toLocaleString() : '—'}
                      {item.updated_by && <div>{item.updated_by}</div>}
                    </td>
                    {isMgmt && (
                      <td className="text-right">
                        <button onClick={() => deleteItem(item)} className="text-ink-muted hover:text-danger text-[18px] leading-none">×</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="md:hidden divide-y divide-line-subtle">
            {items.map((item) => {
              const low = item.par_level > 0 && item.current_stock / item.par_level < 0.2
              return (
                <div key={item.item_id} className={`p-4 ${low ? 'bg-danger-tint/40' : ''}`}>
                  <div className="flex justify-between mb-2">
                    <div className="text-[15px] font-medium text-ink">{item.item_name}</div>
                    {isMgmt && <button onClick={() => deleteItem(item)} className="text-ink-muted text-[18px] leading-none">×</button>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <div className="label">Stock</div>
                      <input className="input" type="number" defaultValue={item.current_stock}
                        onBlur={(e) => updateField(item, 'current_stock', Number(e.target.value))} />
                    </div>
                    <div>
                      <div className="label">Par</div>
                      <input className="input" type="number" defaultValue={item.par_level}
                        onBlur={(e) => updateField(item, 'par_level', Number(e.target.value))}
                        disabled={!isMgmt} />
                    </div>
                  </div>
                  <StockBar current={item.current_stock} par={item.par_level} />
                  {item.last_updated && (
                    <div className="text-[12px] text-ink-muted mt-2">{item.updated_by} · {new Date(item.last_updated).toLocaleDateString()}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function AddItemForm({ propertyId, category, onAdded }) {
  const api = useApi()
  const [name, setName] = useState('')
  const [par, setPar] = useState(0)
  const [unit, setUnit] = useState('each')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.post(`/api/inventory/${propertyId}/items`, {
        category, item_name: name, par_level: Number(par), unit,
      })
      setName(''); setPar(0)
      onAdded?.()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card bg-surface-subtle">
      <h3 className="section-title mb-3">Add inventory item</h3>
      <div className="grid sm:grid-cols-[1fr,120px,120px,auto] gap-2">
        <input className="input" placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Par" type="number" value={par} onChange={(e) => setPar(e.target.value)} />
        <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option>each</option><option>box</option><option>case</option><option>bag</option>
        </select>
        <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add'}</button>
      </div>
    </div>
  )
}
