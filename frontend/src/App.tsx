import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { Customers } from './pages/Customers'
import { NewOrder } from './pages/NewOrder'
import { OrderDetail } from './pages/OrderDetail'
import { Orders } from './pages/Orders'

export default function App() {
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
          <NavLink to="/customers" className={({ isActive }) => (isActive ? 'active' : '')}>
            Customers
          </NavLink>
        </nav>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/orders" replace />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/new" element={<NewOrder />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
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
