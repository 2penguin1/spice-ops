import { readFileSync } from 'node:fs'

import { pool } from './client.ts'

const sqlPath = new URL('../../../database/seed.sql', import.meta.url)

await pool.query(readFileSync(sqlPath, 'utf8'))

const { rows } = await pool.query<{ customers: string; orders: string; items: string }>(`
  SELECT (SELECT count(*) FROM customers)   AS customers,
         (SELECT count(*) FROM orders)      AS orders,
         (SELECT count(*) FROM order_items) AS items
`)

console.log('Seeded:', rows[0])
await pool.end()
