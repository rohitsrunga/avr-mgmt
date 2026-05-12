import { Outlet } from 'react-router-dom'
import Header from './Header'
import NavTabs from './NavTabs'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <NavTabs />
      <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 max-w-7xl w-full">
        <Outlet />
      </main>
      <footer className="text-center text-text-muted text-xs py-4 font-mono">
        AVR Management · Saish LLC
      </footer>
    </div>
  )
}
