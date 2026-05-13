import { Outlet } from 'react-router-dom'
import Header from './Header'
import NavTabs from './NavTabs'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-muted">
      <Header />
      <NavTabs />
      <main className="flex-1 container mx-auto px-4 sm:px-6 py-8 max-w-7xl w-full">
        <Outlet />
      </main>
      <footer className="text-center text-ink-faint text-[12px] py-6">
        AVR Hospitality Management
      </footer>
    </div>
  )
}
