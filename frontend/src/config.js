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

// Tabs surfaced in the in-app nav. The five lanes consolidate the legacy 11
// pages. Per-section features (dinner, business_case, groups, inspections) are
// hidden inside the tab when their per-property toggle is off — the tab itself
// is always visible to roles that have it in `tabs`.
export const ROLES = [
  { id: 'owner',        label: 'Owner',        tabs: ['property','checklists','marketing','inventory','admin'] },
  { id: 'manager',      label: 'Manager',      tabs: ['property','checklists','marketing','inventory'] },
  { id: 'frontdesk',    label: 'Front Desk',   tabs: ['property','checklists','marketing','inventory'] },
  { id: 'housekeeping', label: 'Housekeeping', tabs: ['property','checklists'] },
  { id: 'grounds',      label: 'Grounds',      tabs: ['checklists'] },
  { id: 'breakfast',    label: 'Breakfast',    tabs: ['checklists','inventory'] },
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

// Features the Admin tab lets owners toggle on/off per property. The runtime
// status (which feature is on for which property) lives in DynamoDB, fetched
// at sign-in by useFeatureConfig — these IDs only declare what's toggleable.
// New sections that should also be toggleable: add them here AND in
// backend/shared/settings.py:TOGGLEABLE_FEATURES.
export const TOGGLEABLE_FEATURES = [
  'dinner',
  'business_case',
  'groups',
  'inspections',
]

// Human-readable labels for the Admin feature toggle UI.
export const FEATURE_LABELS = {
  dinner:         'Dinner Orders',
  business_case:  'Business Case',
  groups:         'Group Contracts',
  inspections:    'Inspections',
}

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

// Business-case daily marketing/business tasks (mirrors backend definitions).
export const BUSINESS_CASE_TASKS = [
  { id: 'madalia_reviews', label: 'Madalia Online Booking Reviews', icon: '⭐' },
  { id: 'cvent_rfp',       label: 'Cvent RFP',                      icon: '📨' },
  { id: 'business_cases',  label: 'Business Cases',                 icon: '💼' },
  { id: 'leisure',         label: 'Leisure',                        icon: '🌴' },
  { id: 'transient',       label: 'Transient',                      icon: '🚗' },
  { id: 'reply_reviews',   label: 'Reply All Reviews',              icon: '💬' },
]

// Group contract status + room-type vocab (mirrors backend).
export const GROUP_STATUSES = [
  { id: 'inquiry',    label: 'Inquiry',     tone: 'warning' },
  { id: 'confirmed',  label: 'Confirmed',   tone: 'brand' },
  { id: 'checked_in', label: 'Checked-in',  tone: 'positive' },
  { id: 'completed',  label: 'Completed',   tone: 'neutral' },
  { id: 'cancelled',  label: 'Cancelled',   tone: 'danger' },
]
export const GROUP_ROOM_TYPES = [
  { id: 'standard', label: 'Standard' },
  { id: 'triple',   label: 'Triple' },
  { id: 'quad',     label: 'Quad' },
  { id: 'mixed',    label: 'Mixed' },
]

// Inspection vocab (also exposed by /meta/constants but cached here for SSR-style speed).
export const INSPECTION_TYPES = [
  { id: 'routine',          label: 'Routine Check' },
  { id: 'post_checkout',    label: 'Post-Checkout' },
  { id: 'post_maintenance', label: 'Post-Maintenance' },
  { id: 'deep_clean',       label: 'Deep Clean' },
  { id: 'pre_vip',          label: 'Pre-VIP' },
]
export const INSPECTION_CATEGORIES = [
  { id: 'cleanliness', label: 'Cleanliness', emoji: '🧹' },
  { id: 'maintenance', label: 'Maintenance', emoji: '🔧' },
  { id: 'furniture',   label: 'Furniture',   emoji: '🪑' },
  { id: 'plumbing',    label: 'Plumbing',    emoji: '🚿' },
  { id: 'electrical',  label: 'Electrical',  emoji: '⚡' },
  { id: 'hvac',        label: 'HVAC',        emoji: '❄️' },
  { id: 'safety',      label: 'Safety',      emoji: '🔒' },
  { id: 'cosmetic',    label: 'Cosmetic',    emoji: '🎨' },
]
export const INSPECTION_SEVERITIES = [
  { id: 'urgent',   label: 'Urgent',   tone: 'danger' },
  { id: 'standard', label: 'Standard', tone: 'warning' },
  { id: 'minor',    label: 'Minor',    tone: 'neutral' },
  { id: 'note',     label: 'Note',     tone: 'brand' },
]
