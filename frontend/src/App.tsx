import { Suspense, lazy } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { Icon } from './components/Icon'
import { useAuth, type Staff } from './lib/auth'
import { canEditCustomers, canSeeDashboard, canTakeOrders } from './lib/permissions'
import { Customers } from './pages/Customers'
import { Kitchen } from './pages/Kitchen'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { NewOrder } from './pages/NewOrder'
import { OrderDetail } from './pages/OrderDetail'
import { Orders } from './pages/Orders'

// Loaded on demand: the charting library is most of the bundle and only
// managers and admins ever open this screen.
const Dashboard = lazy(() =>
  import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })),
)

export default function App() {
  const { staff } = useAuth()

  return (
    <Routes>
      <Route path="/" element={staff ? <Navigate to="/orders" replace /> : <Landing />} />
      <Route path="/login" element={staff ? <Navigate to="/orders" replace /> : <Login />} />
      <Route path="/*" element={staff ? <Workspace staff={staff} /> : <Navigate to="/login" replace />} />
    </Routes>
  )
}

/** Everything behind a sign-in: the sidebar and the pages it points at. */
function Workspace({ staff }: { staff: Staff }) {
  return (
    <div className="app">
      <Sidebar staff={staff} />
      <main>
        <Suspense fallback={<div className="page">Loading…</div>}>
          <Routes>
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/kitchen" element={<Kitchen />} />
            <Route
              path="/orders/new"
              element={canTakeOrders(staff.role) ? <NewOrder /> : <Navigate to="/orders" replace />}
            />
            <Route
              path="/customers"
              element={canEditCustomers(staff.role) ? <Customers /> : <Navigate to="/orders" replace />}
            />
            <Route
              path="/dashboard"
              element={canSeeDashboard(staff.role) ? <Dashboard /> : <Navigate to="/orders" replace />}
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}

function Sidebar({ staff }: { staff: Staff }) {
  const { signOut } = useAuth()

  return (
    <aside className="sidebar">
      <Link className="wordmark" to="/orders">
        <span className="wordmark-mark" />
        SPICE GARDEN
      </Link>

      <p className="nav-label">Floor</p>
      <NavItem to="/orders" icon="orders" label="Orders" />
      {canTakeOrders(staff.role) && <NavItem to="/orders/new" icon="plus" label="New order" />}

      <p className="nav-label">Kitchen</p>
      <NavItem to="/kitchen" icon="kitchen" label="Board" />

      {(canEditCustomers(staff.role) || canSeeDashboard(staff.role)) && (
        <p className="nav-label">Manage</p>
      )}
      {canEditCustomers(staff.role) && <NavItem to="/customers" icon="customers" label="Customers" />}
      {canSeeDashboard(staff.role) && <NavItem to="/dashboard" icon="dashboard" label="Dashboard" />}

      <div className="sidebar-foot">
        <div className="whoami">
          <span className="avatar">{initials(staff.name)}</span>
          <span>
            <span className="whoami-name">{staff.name}</span>
            <span className="whoami-role">{staff.role}</span>
          </span>
        </div>
        <button type="button" className="signout" onClick={signOut}>
          Sign out
        </button>
      </div>
    </aside>
  )
}

function NavItem({ to, icon, label }: { to: string; icon: 'orders' | 'kitchen' | 'customers' | 'dashboard' | 'plus'; label: string }) {
  return (
    <NavLink to={to} end className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
      <Icon name={icon} />
      {label}
    </NavLink>
  )
}

const initials = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

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
