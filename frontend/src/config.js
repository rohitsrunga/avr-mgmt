export const CONFIG = {
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
  userPoolId: import.meta.env.VITE_USER_POOL_ID || '',
  userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || '',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
  publicFormsBaseUrl: import.meta.env.VITE_PUBLIC_FORMS_BASE_URL || '',
}

export const PROPERTIES = [
  { id: 'casco_bay', name: 'Casco Bay Hotel', short: 'Casco Bay' },
  { id: 'saco_bay', name: 'Saco Bay Hotel', short: 'Saco Bay' },
]

export const SHIFTS = [
  { id: '1st', label: '1st', range: '7am – 3pm' },
  { id: '2nd', label: '2nd', range: '3pm – 11pm' },
  { id: '3rd', label: '3rd', range: '11pm – 7am' },
]

// Tabs surfaced in the in-app nav. `dinner` is gated to Casco Bay at render time.
export const ROLES = [
  { id: 'owner',        label: 'Owner',        tabs: ['overview','shifts','inventory','rooms','housekeeping','dinner','admin'] },
  { id: 'manager',      label: 'Manager',      tabs: ['overview','shifts','inventory','rooms','housekeeping','dinner'] },
  { id: 'frontdesk',    label: 'Front Desk',   tabs: ['overview','shifts','inventory','rooms','housekeeping','dinner'] },
  { id: 'housekeeping', label: 'Housekeeping', tabs: ['shifts','rooms'] },
  { id: 'grounds',      label: 'Grounds',      tabs: ['shifts'] },
  { id: 'breakfast',    label: 'Breakfast',    tabs: ['shifts','inventory'] },
]

// Includes the new "linen" category that absorbs the former Linen tab.
export const INVENTORY_CATEGORIES = [
  { id: 'breakfast_food', label: 'Breakfast Food' },
  { id: 'breakfast_beverage', label: 'Breakfast Beverage' },
  { id: 'breakfast_supply', label: 'Breakfast Supplies' },
  { id: 'housekeeping', label: 'Housekeeping' },
  { id: 'linen', label: 'Linen' },
  { id: 'amenity', label: 'Amenities' },
  { id: 'front_desk', label: 'Front Desk' },
]

// Standalone checklists rendered inside the Shift Checklist tab.
export const CHECKLIST_TYPES = [
  { id: 'breakfast', label: 'Breakfast Cleanup' },
  { id: 'groundsman', label: 'Groundsman' },
]

export const ROOM_EQUIPMENT_FIELDS = [
  { id: 'comforter_cover', label: 'Comforter Cover' },
  { id: 'cabinet', label: 'Cabinet' },
  { id: 'ironing_board', label: 'Ironing Board' },
  { id: 'iron_hanger', label: 'Iron Hanger' },
  { id: 'iron', label: 'Iron' },
  { id: 'luggage_rack', label: 'Luggage Rack' },
  { id: 'hangers', label: 'Hangers' },
  { id: 'microwave', label: 'Microwave' },
  { id: 'fridge', label: 'Fridge' },
  { id: 'ice_bucket', label: 'Ice Bucket' },
  { id: 'keurig', label: 'Keurig' },
  { id: 'desk_chair', label: 'Desk Chair' },
  { id: 'lounge_chair', label: 'Lounge Chair' },
  { id: 'hairdryer', label: 'Hairdryer' },
  { id: 'soap_dish', label: 'Soap Dish' },
]

// Properties that surface the dinner-orders dashboard.
export const DINNER_ENABLED_PROPERTIES = new Set(['casco_bay'])

// Dinner menu options (Casco Bay evening dinner program).
export const DINNER_MENU = {
  sides: [
    { id: 'salad', label: 'Salad' },
    { id: 'cookie', label: 'Cookie' },
    { id: 'chips', label: 'Chips' },
    { id: 'mac_cheese', label: 'Macaroni and Cheese' },
  ],
  sandwiches: [
    { id: 'none', label: 'No sandwich' },
    { id: 'chicken', label: 'Chicken' },
    { id: 'veggie', label: 'Veggie' },
  ],
  drinks: [
    { id: 'water', label: 'Water' },
    { id: 'soda', label: 'Soda' },
    { id: 'juice', label: 'Juice' },
    { id: 'none', label: 'No drink' },
  ],
}
