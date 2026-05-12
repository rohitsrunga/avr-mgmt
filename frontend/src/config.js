export const CONFIG = {
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
  userPoolId: import.meta.env.VITE_USER_POOL_ID || '',
  userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || '',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
}

export const PROPERTIES = [
  { id: 'casco_bay', name: 'Casco Bay Hotel', short: 'Casco Bay', accent: 'teal' },
  { id: 'saco_bay', name: 'Saco Bay Hotel', short: 'Saco Bay', accent: 'amber' },
]

export const SHIFTS = [
  { id: '1st', label: '1st', range: '7am – 3pm', accent: 'amber' },
  { id: '2nd', label: '2nd', range: '3pm – 11pm', accent: 'green' },
  { id: '3rd', label: '3rd', range: '11pm – 7am', accent: 'blue' },
]

export const ROLES = [
  { id: 'owner', label: 'Owner', tabs: ['overview','shifts','inventory','checklists','rooms','parkfly','linen','reports','admin'] },
  { id: 'manager', label: 'Manager', tabs: ['overview','shifts','inventory','checklists','rooms','parkfly','linen','reports'] },
  { id: 'frontdesk', label: 'Front Desk', tabs: ['overview','shifts','inventory','checklists','rooms','parkfly'] },
  { id: 'housekeeping', label: 'Housekeeping', tabs: ['checklists','rooms','linen'] },
  { id: 'grounds', label: 'Grounds', tabs: ['checklists'] },
  { id: 'breakfast', label: 'Breakfast', tabs: ['checklists','inventory'] },
]

export const INVENTORY_CATEGORIES = [
  { id: 'breakfast_food', label: 'Breakfast Food' },
  { id: 'breakfast_beverage', label: 'Breakfast Beverage' },
  { id: 'breakfast_supply', label: 'Breakfast Supplies' },
  { id: 'housekeeping', label: 'Housekeeping' },
  { id: 'amenity', label: 'Amenities' },
  { id: 'front_desk', label: 'Front Desk' },
]

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
