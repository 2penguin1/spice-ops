import type { Customer, OrderDetail, OrderStatus, Page } from './types'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

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
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : {},
    })
  } catch {
    // fetch only rejects when the request never reached the server.
    throw new ApiError('NETWORK_ERROR', `Cannot reach the API at ${BASE}. Is the server running?`, 0)
  }

  if (response.status === 204) return undefined as T

  const body = await response.json().catch(() => null)

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
  health: () => data<{ status: string; db: string }>('/health'),

  orders: {
    list: (filters: OrderFilters) => request<Page<OrderDetail>>(`/orders${query(filters)}`),
    get: (id: string) => data<OrderDetail>(`/orders/${id}`),
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
