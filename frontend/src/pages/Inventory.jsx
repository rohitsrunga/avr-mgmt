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
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold flex-1">Inventory</h1>
        {isMgmt && (
          <button onClick={() => setShowAdd((s) => !s)} className="btn-secondary text-sm">
            {showAdd ? 'Cancel' : '+ Add item'}
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {INVENTORY_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`px-3 py-2 rounded-md text-sm whitespace-nowrap ${category === c.id ? 'bg-accent-teal text-white' : 'bg-ink-800 text-text-secondary hover:text-text-primary'}`}
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
        <div className="card text-center py-10 text-text-muted">No items in this category yet.</div>
      ) : (
        <div className="card overflow-hidden p-0">
          {/* desktop table */}
          <table className="w-full text-sm hidden md:table">
            <thead className="bg-ink-900 text-text-secondary text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2.5">Item</th>
                <th className="text-left px-4 py-2.5 w-32">Stock / Par</th>
                <th className="text-left px-4 py-2.5 w-48">Bar</th>
                <th className="text-left px-4 py-2.5 w-36">Last update</th>
                {isMgmt && <th className="px-4 py-2.5 w-12"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {items.map((item) => (
                <tr key={item.item_id} className={item.par_level > 0 && item.current_stock / item.par_level < 0.2 ? 'bg-accent-red/10' : ''}>
                  <td className="px-4 py-2.5">
                    <div>{item.item_name}</div>
                    <div className="tag">{item.unit}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1 items-center">
                      <input className="input w-16 text-center py-1 min-h-0" type="number" defaultValue={item.current_stock}
                        onBlur={(e) => updateField(item, 'current_stock', Number(e.target.value))} />
                      <span className="text-text-muted">/</span>
                      <input className="input w-16 text-center py-1 min-h-0" type="number" defaultValue={item.par_level}
                        onBlur={(e) => updateField(item, 'par_level', Number(e.target.value))}
                        disabled={!isMgmt} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><StockBar current={item.current_stock} par={item.par_level} /></td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary">
                    {item.last_updated ? new Date(item.last_updated).toLocaleString() : '—'}
                    {item.updated_by && <div className="tag">{item.updated_by}</div>}
                  </td>
                  {isMgmt && (
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => deleteItem(item)} className="text-text-muted hover:text-accent-red">×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {/* mobile cards */}
          <div className="md:hidden divide-y divide-ink-700">
            {items.map((item) => (
              <div key={item.item_id} className={`p-4 ${item.par_level > 0 && item.current_stock / item.par_level < 0.2 ? 'bg-accent-red/10' : ''}`}>
                <div className="flex justify-between mb-2">
                  <div className="font-medium">{item.item_name}</div>
                  {isMgmt && <button onClick={() => deleteItem(item)} className="text-text-muted">×</button>}
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
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
                  <div className="tag mt-2">{item.updated_by} · {new Date(item.last_updated).toLocaleDateString()}</div>
                )}
              </div>
            ))}
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
    <div className="card border-accent-amber/40">
      <h3 className="font-display text-base font-semibold mb-3">Add inventory item</h3>
      <div className="grid sm:grid-cols-[1fr,120px,120px,auto] gap-2">
        <input className="input" placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Par" type="number" value={par} onChange={(e) => setPar(e.target.value)} />
        <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option>each</option><option>box</option><option>case</option><option>bag</option>
        </select>
        <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add'}</button>
      </div>
    </div>
  )
}
