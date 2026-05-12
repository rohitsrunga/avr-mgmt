import { useEffect, useState } from 'react'
import Banner from '../components/Banner'
import { useApi } from '../hooks/useApi'
import { useProperty } from '../hooks/useProperty'

export default function Linen() {
  const api = useApi()
  const { propertyId } = useProperty()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')

  async function load() {
    try {
      setError('')
      const res = await api.get(`/api/linen/${propertyId}`, { month })
      setRows(res.rows || [])
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => { load() }, [propertyId, month])

  async function setCount(linen_type, week, count) {
    try {
      await api.put(`/api/linen/${propertyId}`, { month, linen_type, week, count })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold flex-1">Linen counts</h1>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input max-w-xs" />
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-text-secondary text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Linen</th>
              <th className="px-3 py-2">Wk 1</th>
              <th className="px-3 py-2">Wk 2</th>
              <th className="px-3 py-2">Wk 3</th>
              <th className="px-3 py-2">Wk 4</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700">
            {rows.map((row) => (
              <tr key={row.linen_type}>
                <td className="px-3 py-2 font-medium">{row.linen_type}</td>
                {[1, 2, 3, 4].map((w) => (
                  <td key={w} className="px-2 py-1.5 text-center w-24">
                    <input
                      className="input w-full text-center py-1 min-h-0"
                      type="number"
                      defaultValue={row[`week_${w}`] ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value
                        if (v !== '' && Number(v) !== row[`week_${w}`]) {
                          setCount(row.linen_type, w, Number(v))
                        }
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
