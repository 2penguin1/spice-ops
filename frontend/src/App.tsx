import { Suspense, lazy } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { useAuth } from './lib/auth'
import { canEditCustomers, canSeeDashboard, canTakeOrders } from './lib/permissions'
import { Customers } from './pages/Customers'
// Loaded on demand: the charting library is most of the bundle and only
// managers and admins ever open this screen.
const Dashboard = lazy(() =>
  import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })),
)
import { Kitchen } from './pages/Kitchen'
import { Login } from './pages/Login'
import { NewOrder } from './pages/NewOrder'
import { OrderDetail } from './pages/OrderDetail'
import { Orders } from './pages/Orders'

export default function App() {
  const { staff, signOut } = useAuth()

  if (!staff) return <Login />

  return (
    <>
      <header className="topbar">
        <Link className="wordmark" to="/orders">
          SPICE<span>·</span>GARDEN
        </Link>
        <nav className="nav">
          <NavLink to="/orders" className={({ isActive }) => (isActive ? 'active' : '')}>
            Orders
          </NavLink>
          <NavLink to="/kitchen" className={({ isActive }) => (isActive ? 'active' : '')}>
            Kitchen
          </NavLink>
          {canSeeDashboard(staff.role) && (
            <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
              Dashboard
            </NavLink>
          )}
          {canEditCustomers(staff.role) && (
            <NavLink to="/customers" className={({ isActive }) => (isActive ? 'active' : '')}>
              Customers
            </NavLink>
          )}
        </nav>

        <div className="whoami">
          <span>{staff.name}</span>
          <span className="role-chip">{staff.role}</span>
          <button type="button" className="link-btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <main>
        <Suspense fallback={<div className="page">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/orders" replace />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/kitchen" element={<Kitchen />} />
          <Route
            path="/dashboard"
            element={canSeeDashboard(staff.role) ? <Dashboard /> : <Navigate to="/orders" replace />}
          />
          <Route
            path="/orders/new"
            element={canTakeOrders(staff.role) ? <NewOrder /> : <Navigate to="/orders" replace />}
          />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route
            path="/customers"
            element={canEditCustomers(staff.role) ? <Customers /> : <Navigate to="/orders" replace />}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </main>
    </>
  )
}

function NotFound() {
  return (
    <div className="page">
      <div className="empty">
        <p>That page does not exist.</p>
        <Link className="btn" to="/orders">
          Go to orders
        </Link>
      </div>
    </div>
  )
}
