import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import { config } from '../config.ts'
import * as schema from './schema.ts'

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL })

// Required, not optional: pg emits 'error' when an *idle* client drops — a
// database restart, a network blip — and an unhandled 'error' event on an
// EventEmitter terminates the process. Logging it lets the pool reconnect
// on the next query instead of taking the API down with it.
pool.on('error', (err) => console.error('Idle database client error:', err.message))

export const db = drizzle(pool, { schema })
