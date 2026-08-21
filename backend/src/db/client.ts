import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import { config } from '../config.ts'
import * as schema from './schema.ts'

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL })

// pg emits 'error' when an idle client drops. Unhandled, that ends the
// process; handled, the pool just reconnects on the next query.
pool.on('error', (err) => console.error('Idle database client error:', err.message))

export const db = drizzle(pool, { schema })
