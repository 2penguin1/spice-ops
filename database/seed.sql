-- Seed data for the Spice Garden OMS.
--
-- Idempotent: truncates first, so `npm run db:seed` can be run repeatedly.
-- Deterministic: no random(). Orders are derived from a series, so every run
-- produces the same data and a screenshot taken today matches one taken later.

BEGIN;

TRUNCATE order_items, orders, customers RESTART IDENTITY CASCADE;
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

COMMIT;
