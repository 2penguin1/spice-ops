/**
 * What staff pick from when taking an order.
 *
 * A constant rather than a table: an order item carries a name and a price but
 * no menu id, and the price is copied onto the order when it is placed, so
 * changing one here never rewrites an old order. Matches database/seed.sql.
 *
 * `photo` names a file in public/menu — staff recognise a dish faster than
 * they read it. `diet` drives the green or brown mark that Indian food
 * labelling rules put on every printed menu.
 */
export const MENU = [
  { itemName: 'Paneer Butter Masala', unitPrice: 320, photo: 'paneer-butter-masala', diet: 'veg' },
  { itemName: 'Chicken Biryani', unitPrice: 380, photo: 'chicken-biryani', diet: 'nonveg' },
  { itemName: 'Garlic Naan', unitPrice: 70, photo: 'garlic-naan', diet: 'veg' },
  { itemName: 'Dal Makhani', unitPrice: 280, photo: 'dal-makhani', diet: 'veg' },
  { itemName: 'Masala Dosa', unitPrice: 180, photo: 'masala-dosa', diet: 'veg' },
  { itemName: 'Tandoori Roti', unitPrice: 40, photo: 'tandoori-roti', diet: 'veg' },
  { itemName: 'Hyderabadi Haleem', unitPrice: 420, photo: 'hyderabadi-haleem', diet: 'nonveg' },
  { itemName: 'Gulab Jamun', unitPrice: 120, photo: 'gulab-jamun', diet: 'veg' },
  { itemName: 'Mango Lassi', unitPrice: 150, photo: 'mango-lassi', diet: 'veg' },
  { itemName: 'Veg Pulao', unitPrice: 240, photo: 'veg-pulao', diet: 'veg' },
] as const

export type MenuItem = (typeof MENU)[number]

export const photoUrl = (photo: string) => `/menu/${photo}.jpg`
