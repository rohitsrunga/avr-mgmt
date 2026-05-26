import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './auth/LoginPage'
import ProtectedRoute from './auth/ProtectedRoute'
import Layout from './components/Layout'
import Welcome from './pages/Welcome'
import Property from './pages/Property'
import Checklists from './pages/Checklists'
import Marketing from './pages/Marketing'
import Inventory from './pages/Inventory'
import Admin from './pages/Admin'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Welcome />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="checklists" replace />} />
        <Route path="checklists" element={<Checklists />} />
        <Route path="property" element={<ProtectedRoute allowedRoles={['owner','manager','frontdesk','housekeeping']}><Property /></ProtectedRoute>} />
        <Route path="marketing" element={<ProtectedRoute allowedRoles={['owner','manager','frontdesk']}><Marketing /></ProtectedRoute>} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="admin" element={<ProtectedRoute allowedRoles={['owner']}><Admin /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
