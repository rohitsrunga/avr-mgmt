import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './auth/LoginPage'
import ProtectedRoute from './auth/ProtectedRoute'
import Layout from './components/Layout'
import Welcome from './pages/Welcome'
import Dashboard from './pages/Dashboard'
import Shifts from './pages/Shifts'
import Inventory from './pages/Inventory'
import Checklists from './pages/Checklists'
import Rooms from './pages/Rooms'
import ParkFly from './pages/ParkFly'
import Linen from './pages/Linen'
import Reports from './pages/Reports'
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
        <Route path="checklists" element={<Checklists />} />
        <Route path="rooms" element={<Rooms />} />
        <Route path="parkfly" element={<ParkFly />} />
        <Route path="linen" element={<Linen />} />
        <Route path="reports" element={<ProtectedRoute allowedRoles={['owner','manager']}><Reports /></ProtectedRoute>} />
        <Route path="admin" element={<ProtectedRoute allowedRoles={['owner']}><Admin /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
