-- Seed data for the Spice Garden OMS.
--
-- Idempotent: truncates first, so `npm run db:seed` can be run repeatedly.
-- Deterministic: no random(). Orders are derived from a series, so every run
-- produces the same data and a screenshot taken today matches one taken later.

BEGIN;

TRUNCATE staff, order_status_events, order_items, orders, customers RESTART IDENTITY CASCADE;
ALTER SEQUENCE order_number_seq RESTART WITH 1;

-- Staff accounts. Every password is `spice123` for the demo; each row carries
-- its own salt, so two people with the same password do not share a hash.
INSERT INTO staff (name, email, password_hash, role) VALUES
  ('Asha Menon', 'admin@spice.test', 'scrypt$9068ec9df45aa123d9902a10b2b4a406$ca7e18d5d198bda8fb7f86c2e1a79b8d36322a2ffd4b1ea1cc345e899a1dce5c923ab5f70ea406d98053645d16d85cbd67acdf2a10181db3d0e1266da91a3ddb', 'ADMIN'),
  ('Vikram Rao', 'manager@spice.test', 'scrypt$f32c9382575b475d191e6b9c9d7996fb$91c4ef9b79bab42547389a68fa0fbf126554aad66e01bb1963dcf70e1b34384fcb74f604c4dad5f93c73b48edbc5723be7056fdffb95adb2fd7152df31b8c808', 'MANAGER'),
  ('Sunil Kapoor', 'cook@spice.test', 'scrypt$7cd05363683a965729254c1d7ef5f0dc$1f8199cd26e7c22c98887c3df37fd438d796dd2982b3d58f7d56f1d4e986fa45f6f150e702042139a38560cd885829fc4c0ce4c5699e9d3fdc84a2e80f5a1ef1', 'KITCHEN'),
  ('Rekha Iyer', 'cook2@spice.test', 'scrypt$d30108014cb651c6f4a226c25e997851$5b802d50bd1fabf2152ac2c7d616ba12d8331df4f8197a83cd67ce117de1586decf7b09792346b891ce3bce3340fce73af0f79f164835129b5b7b7b01cd54fa6', 'KITCHEN'),
  ('Nisha Patel', 'server@spice.test', 'scrypt$a8bfa321fc5b5c822991e3c450d938e3$eb3dafe3ff2d9343c51f0fd19118d236f903d10d9594a476bada2e0f539ae8441d856491a7bd13357ce02e44a9fdbc6cfbfbe948c4b79b7ac4f482a11a182b60', 'SERVICE');

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
    -- Lunch and dinner, three orders a day, so "when orders arrive" shows a
    -- service pattern rather than an artefact of the generator.
    date_trunc('day', now())
      - make_interval(days => (g / 3)::int)
      + make_interval(
          hours => (ARRAY[12, 13, 14, 19, 20, 21])[(g % 6) + 1],
          mins  => (g * 17) % 60
        ) AS placed_at,
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

-- Attribute the seeded history to staff, so the dashboard has something real
-- to show. Two cooks alternate by order, which is what makes a per-cook
-- comparison meaningful rather than a single row.
WITH cooks AS (
  SELECT id, row_number() OVER (ORDER BY email) - 1 AS n FROM staff WHERE role = 'KITCHEN'
),
numbered AS (
  SELECT id AS order_id, row_number() OVER (ORDER BY created_at) AS rn FROM orders
)
UPDATE order_status_events e
SET staff_id = cooks.id
FROM numbered
JOIN cooks ON cooks.n = numbered.rn % (SELECT count(*) FROM staff WHERE role = 'KITCHEN')
WHERE e.order_id = numbered.order_id
  AND e.to_status IN ('PREPARING', 'READY');

UPDATE order_status_events e
SET staff_id = (SELECT id FROM staff WHERE role = 'SERVICE' LIMIT 1)
WHERE e.to_status = 'COMPLETED';

UPDATE order_status_events e
SET staff_id = (SELECT id FROM staff WHERE role = 'MANAGER' LIMIT 1)
WHERE e.to_status = 'CANCELLED';

COMMIT;
