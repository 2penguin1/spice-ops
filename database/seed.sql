-- Seed data for the Spice Garden OMS.
--
-- Idempotent: truncates first, so `npm run db:seed` can be run repeatedly.
-- Deterministic: no random(). Orders are derived from a series, so every run
-- produces the same data and a screenshot taken today matches one taken later.

BEGIN;

TRUNCATE order_status_events, order_items, orders, customers RESTART IDENTITY CASCADE;
ALTER SEQUENCE order_number_seq RESTART WITH 1;

INSERT INTO customers (name, email, phone) VALUES
  ('Aarav Sharma',   'aarav.sharma@example.com',  '+91 98200 11223'),
  ('Diya Nair',      'diya.nair@example.com',     '+91 98200 44556'),
  ('Rohan Mehta',    NULL,                        '+91 98200 77889'),
  ('Ishita Banerjee','ishita.b@example.com',      '+91 98111 22334'),
  ('Kabir Singh',    'kabir.singh@example.com',   '+91 98111 55667'),
  ('Ananya Rao',     NULL,                        '+91 98111 88990'),
  ('Vikram Desai',   'vikram.desai@example.com',  '+91 99300 12345'),
  ('Meera Iyer',     'meera.iyer@example.com',    '+91 99300 67890');

-- 40 orders spread back over ~13 days, one every 8 hours.
-- Status follows age: the newest orders are still moving through the kitchen,
-- older ones have finished. Every fifteenth order is cancelled, so the
-- cancellation rate on the dashboard is non-zero but realistic.
WITH numbered_customers AS (
  SELECT id, row_number() OVER (ORDER BY phone) - 1 AS n FROM customers
),
planned AS (
  SELECT
    g,
    now() - make_interval(hours => g * 8) AS placed_at,
    CASE
      WHEN g % 15 = 0 THEN 'CANCELLED'
      WHEN g <= 3     THEN 'CONFIRMED'
      WHEN g <= 6     THEN 'PREPARING'
      WHEN g <= 9     THEN 'READY'
      ELSE                 'COMPLETED'
    END::order_status AS status
  FROM generate_series(1, 40) AS g
)
INSERT INTO orders (customer_id, status, created_at, updated_at)
SELECT c.id, p.status, p.placed_at, p.placed_at
FROM planned p
JOIN numbered_customers c ON c.n = (p.g - 1) % 8
ORDER BY p.g DESC;   -- oldest inserted first, so ORD-000001 is the oldest order

-- 1–4 line items per order, drawn from the menu the frontend also uses.
WITH menu (idx, item_name, unit_price) AS (VALUES
  (0, 'Paneer Butter Masala', 320.00),
  (1, 'Chicken Biryani',      380.00),
  (2, 'Garlic Naan',           70.00),
  (3, 'Dal Makhani',          280.00),
  (4, 'Masala Dosa',          180.00),
  (5, 'Tandoori Roti',         40.00),
  (6, 'Hyderabadi Haleem',    420.00),
  (7, 'Gulab Jamun',          120.00),
  (8, 'Mango Lassi',          150.00),
  (9, 'Veg Pulao',            240.00)
),
numbered_orders AS (
  SELECT id, row_number() OVER (ORDER BY created_at) AS n FROM orders
),
picks AS (
  SELECT
    o.id AS order_id,
    (o.n * 3 + k) % 10 AS idx,
    1 + (o.n + k) % 3  AS quantity
  FROM numbered_orders o
  CROSS JOIN generate_series(0, o.n % 4) AS k
)
INSERT INTO order_items (order_id, item_name, quantity, unit_price)
SELECT p.order_id, m.item_name, p.quantity, m.unit_price
FROM picks p
JOIN menu m ON m.idx = p.idx;

-- Status history, derived from each order's final status so the timeline and
-- the prep-time metrics have something real to read. Times come from the row
-- number, not random(), so a seeded database is identical every run.
WITH numbered AS (
  SELECT id, status, created_at, row_number() OVER (ORDER BY created_at) AS n
  FROM orders
),
steps AS (
  SELECT
    id, status, created_at, n,
    make_interval(mins => ( 2 + (n % 7))::int)  AS to_prep,   -- 2-8 min before a cook starts
    make_interval(mins => ( 9 + (n % 17))::int) AS to_ready,  -- 9-25 min cooking
    make_interval(mins => ( 3 + (n % 8))::int)  AS to_done,   -- 3-10 min to reach the table
    make_interval(mins => ( 5 + (n % 11))::int) AS to_cancel
  FROM numbered
)
INSERT INTO order_status_events (order_id, from_status, to_status, created_at)
  SELECT id, NULL, 'CONFIRMED'::order_status, created_at
  FROM steps
UNION ALL
  SELECT id, 'CONFIRMED'::order_status, 'PREPARING'::order_status, created_at + to_prep
  FROM steps WHERE status IN ('PREPARING', 'READY', 'COMPLETED')
UNION ALL
  SELECT id, 'PREPARING'::order_status, 'READY'::order_status, created_at + to_prep + to_ready
  FROM steps WHERE status IN ('READY', 'COMPLETED')
UNION ALL
  SELECT id, 'READY'::order_status, 'COMPLETED'::order_status,
         created_at + to_prep + to_ready + to_done
  FROM steps WHERE status = 'COMPLETED'
UNION ALL
  SELECT id, 'CONFIRMED'::order_status, 'CANCELLED'::order_status, created_at + to_cancel
  FROM steps WHERE status = 'CANCELLED';

-- An order was last touched when its last event happened.
UPDATE orders o
SET updated_at = latest.at
FROM (
  SELECT order_id, max(created_at) AS at FROM order_status_events GROUP BY order_id
) latest
WHERE latest.order_id = o.id;

COMMIT;
