import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { api, setAuthToken } from '../api/client'
import type { Role } from './permissions'

export type Staff = { id: string; name: string; role: Role }

type AuthValue = {
  staff: Staff | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

const STORAGE_KEY = 'spice.session'

function readStored(): { token: string; staff: Staff } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [staff, setStaff] = useState<Staff | null>(() => {
    const stored = readStored()
    if (stored) setAuthToken(stored.token)
    return stored?.staff ?? null
  })

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setAuthToken(null)
    setStaff(null)
  }, [])

  // The API raises this when a token expires mid-session.
  useEffect(() => {
    window.addEventListener('spice:unauthorized', signOut)
    return () => window.removeEventListener('spice:unauthorized', signOut)
  }, [signOut])

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await api.auth.login(email, password)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    setAuthToken(session.token)
    setStaff(session.staff)
  }, [])

  const value = useMemo(() => ({ staff, signIn, signOut }), [staff, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
