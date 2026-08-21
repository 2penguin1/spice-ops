/**
 * The menu the staff pick from when taking an order.
 *
 * A constant, not a table: the API's item shape carries a name and a price but
 * no menu item id, so the catalogue lives with the UI that uses it. Prices are
 * copied into the order at the time it is placed, which is what keeps old
 * orders financially accurate when these change. Matches database/seed.sql.
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
