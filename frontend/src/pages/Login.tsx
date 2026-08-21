import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ApiError } from '../api/client'
import { useAuth } from '../lib/auth'

const DEMO = [
  { role: 'Manager', email: 'manager@spice.test', does: 'everything on the floor' },
  { role: 'Kitchen', email: 'cook@spice.test', does: 'starts prep, marks ready' },
  { role: 'Service', email: 'server@spice.test', does: 'takes orders, completes them' },
  { role: 'Admin', email: 'admin@spice.test', does: 'staff and settings too' },
]

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('manager@spice.test')
  const [password, setPassword] = useState('spice123')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (caught) {
      setError(caught as ApiError)
      setBusy(false)
    }
  }

  return (
    <div className="signin">
      <form className="panel signin-card" onSubmit={submit}>
        <Link className="eyebrow" to="/" style={{ display: 'block', textDecoration: 'none' }}>
          ← Spice Garden
        </Link>
        <h1>Sign in</h1>
        <p className="muted small">Order management for staff on shift.</p>

        {error && (
          <div className="banner" role="alert">
            {error.message}
          </div>
        )}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <button className="btn" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <hr className="perforation" />

        <h2>Demo accounts</h2>
        <p className="muted small" style={{ marginTop: -6 }}>
          Password <code className="num">spice123</code> for all four. Each role sees different
          controls.
        </p>
        <ul className="demo-accounts">
          {DEMO.map((account) => (
            <li key={account.email}>
              <button type="button" className="link-btn" onClick={() => setEmail(account.email)}>
                {account.role}
              </button>
              <span className="muted small"> — {account.does}</span>
            </li>
          ))}
        </ul>
      </form>
    </div>
  )
}
