import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './auth/LoginPage'
import ProtectedRoute from './auth/ProtectedRoute'
import Layout from './components/Layout'
import Welcome from './pages/Welcome'
import Dashboard from './pages/Dashboard'
import Shifts from './pages/Shifts'
import Inventory from './pages/Inventory'
import Rooms from './pages/Rooms'
import Housekeeping from './pages/Housekeeping'
import Dinner from './pages/Dinner'
import Admin from './pages/Admin'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Welcome />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="shifts" element={<Shifts />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="rooms" element={<Rooms />} />
        <Route path="housekeeping" element={<ProtectedRoute allowedRoles={['owner','manager','frontdesk']}><Housekeeping /></ProtectedRoute>} />
        <Route path="dinner" element={<ProtectedRoute allowedRoles={['owner','manager','frontdesk']}><Dinner /></ProtectedRoute>} />
        <Route path="admin" element={<ProtectedRoute allowedRoles={['owner']}><Admin /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
