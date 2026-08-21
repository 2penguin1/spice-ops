/**
 * What staff pick from when taking an order.
 *
 * A constant rather than a table: an order item carries a name and a price but
 * no menu id, and the price is copied onto the order when it is placed, so
 * changing one here never rewrites an old order. Matches database/seed.sql.
 *
 * `photo` names a file in public/menu — staff recognise a dish faster than
 * they read it. `diet` drives the green or brown mark that Indian food
 * labelling rules put on every printed menu. `description` is for the public
 * menu only; the order screens have no room for it.
 */
export const MENU = [
  {
    itemName: 'Paneer Butter Masala',
    unitPrice: 320,
    photo: 'paneer-butter-masala',
    diet: 'veg',
    description: 'Cottage cheese in a tomato and cashew gravy, finished with butter.',
  },
  {
    itemName: 'Chicken Biryani',
    unitPrice: 380,
    photo: 'chicken-biryani',
    diet: 'nonveg',
    description: 'Dum-cooked basmati with marinated chicken, fried onion and saffron.',
  },
  {
    itemName: 'Garlic Naan',
    unitPrice: 70,
    photo: 'garlic-naan',
    diet: 'veg',
    description: 'Leavened bread from the tandoor, brushed with garlic and coriander.',
  },
  {
    itemName: 'Dal Makhani',
    unitPrice: 280,
    photo: 'dal-makhani',
    diet: 'veg',
    description: 'Black lentils simmered overnight with cream and butter.',
  },
  {
    itemName: 'Masala Dosa',
    unitPrice: 180,
    photo: 'masala-dosa',
    diet: 'veg',
    description: 'Fermented rice crêpe folded around spiced potato, with chutney and sambar.',
  },
  {
    itemName: 'Tandoori Roti',
    unitPrice: 40,
    photo: 'tandoori-roti',
    diet: 'veg',
    description: 'Wholewheat bread, blistered against the side of the tandoor.',
  },
  {
    itemName: 'Hyderabadi Haleem',
    unitPrice: 420,
    photo: 'hyderabadi-haleem',
    diet: 'nonveg',
    description: 'Wheat, mutton and lentils pounded slow, with fried onion and lime.',
  },
  {
    itemName: 'Gulab Jamun',
    unitPrice: 120,
    photo: 'gulab-jamun',
    diet: 'veg',
    description: 'Milk dumplings fried dark and left to steep in cardamom syrup.',
  },
  {
    itemName: 'Mango Lassi',
    unitPrice: 150,
    photo: 'mango-lassi',
    diet: 'veg',
    description: 'Thick sweet yoghurt blended with alphonso mango.',
  },
  {
    itemName: 'Veg Pulao',
    unitPrice: 240,
    photo: 'veg-pulao',
    diet: 'veg',
    description: 'Basmati cooked with whole spices, peas and what the market had.',
  },
] as const

export type MenuItem = (typeof MENU)[number]

export const photoUrl = (photo: string) => `/menu/${photo}.jpg`
