import type { Role } from '../lib/permissions'
import type { Customer, OrderDetail, OrderEvent, OrderStatus, Page } from './types'

export const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/**
 * Held in a module variable rather than read from storage on every call, so
 * there is one place that decides what is sent.
 */
let token: string | null = null

export function setAuthToken(next: string | null) {
  token = next
}

/** The server's error envelope, rethrown so components can show `message` directly. */
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    const headers: Record<string, string> = {}
    if (init?.body) headers['content-type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`

    response = await fetch(`${BASE}${path}`, { ...init, headers })
  } catch {
    // fetch only rejects when the request never reached the server.
    throw new ApiError('NETWORK_ERROR', `Cannot reach the API at ${BASE}. Is the server running?`, 0)
  }

  if (response.status === 204) return undefined as T

  const body = await response.json().catch(() => null)

  if (response.status === 401 && !path.startsWith('/auth/login')) {
    // The token expired or was revoked. Tell the app once, rather than letting
    // every screen fail on its own.
    window.dispatchEvent(new Event('spice:unauthorized'))
  }

  if (!response.ok) {
    throw new ApiError(
      body?.error?.code ?? 'INTERNAL_ERROR',
      body?.error?.message ?? 'Something went wrong',
      response.status,
    )
  }

  return body as T
}

/** Unwraps the `{ data }` envelope for endpoints that return a single object. */
const data = async <T>(path: string, init?: RequestInit): Promise<T> =>
  (await request<{ data: T }>(path, init)).data

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
const patch = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) })

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const string = search.toString()
  return string ? `?${string}` : ''
}

export type OrderFilters = {
  search?: string
  status?: OrderStatus
  customerId?: string
  page?: number
  size?: number
}

export type NewOrder = {
  customer: { id?: string | null; name?: string; email?: string | null; phone?: string }
  items: { itemName: string; quantity: number; unitPrice: number }[]
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      data<{ token: string; staff: { id: string; name: string; role: Role } }>(
        '/auth/login',
        post({ email, password }),
      ),
  },

  events: {
    // A ticket lasts 60 seconds and works on no other route, because
    // EventSource cannot send an Authorization header.
    ticket: () => data<{ ticket: string }>('/events/ticket', { method: 'POST' }),
  },

  health: () => data<{ status: string; db: string }>('/health'),

  orders: {
    list: (filters: OrderFilters) => request<Page<OrderDetail>>(`/orders${query(filters)}`),
    get: (id: string) => data<OrderDetail>(`/orders/${id}`),
    timeline: (id: string) => data<OrderEvent[]>(`/orders/${id}/timeline`),
    create: (order: NewOrder) => data<OrderDetail>('/orders', post(order)),
    setStatus: (id: string, status: OrderStatus) =>
      data<OrderDetail>(`/orders/${id}/status`, patch({ status })),
    addItem: (id: string, item: { itemName: string; quantity: number; unitPrice: number }) =>
      data<OrderDetail>(`/orders/${id}/items`, post(item)),
    removeItem: (id: string, itemId: string) =>
      data<OrderDetail>(`/orders/${id}/items/${itemId}`, { method: 'DELETE' }),
  },

  customers: {
    list: (params: { search?: string; page?: number; size?: number }) =>
      request<Page<Customer>>(`/customers${query(params)}`),
    create: (customer: { name: string; email: string | null; phone: string }) =>
      data<Customer>('/customers', post(customer)),
    update: (id: string, changes: Partial<{ name: string; email: string | null; phone: string }>) =>
      data<Customer>(`/customers/${id}`, patch(changes)),
    remove: (id: string) => request<void>(`/customers/${id}`, { method: 'DELETE' }),
  },
}
