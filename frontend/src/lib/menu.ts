/**
 * What staff pick from when taking an order.
 *
 * A constant rather than a table: an order item carries a name and a price but
 * no menu id, and the price is copied onto the order when it is placed, so
 * changing one here never rewrites an old order. Matches database/seed.sql.
 */
export const MENU = [
  { itemName: 'Paneer Butter Masala', unitPrice: 320 },
  { itemName: 'Chicken Biryani', unitPrice: 380 },
  { itemName: 'Garlic Naan', unitPrice: 70 },
  { itemName: 'Dal Makhani', unitPrice: 280 },
  { itemName: 'Masala Dosa', unitPrice: 180 },
  { itemName: 'Tandoori Roti', unitPrice: 40 },
  { itemName: 'Hyderabadi Haleem', unitPrice: 420 },
  { itemName: 'Gulab Jamun', unitPrice: 120 },
  { itemName: 'Mango Lassi', unitPrice: 150 },
  { itemName: 'Veg Pulao', unitPrice: 240 },
] as const
