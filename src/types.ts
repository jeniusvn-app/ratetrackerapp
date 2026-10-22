export type Role = 'admin' | 'user';
export type MiniRmsAccess = 'full' | 'data_only' | 'none';

export interface CalendarPermissions {
  view: boolean;
  edit_rates: boolean;
  view_net_b2b: boolean;
  can_request_price_change: boolean;
}

export interface SettingsPermissions {
  manage_inventory: boolean;
  manage_users: boolean;
}

export interface UserPermissions {
  calendar: CalendarPermissions;
  mini_rms: MiniRmsAccess;
  settings: SettingsPermissions;
}

export const DEFAULT_PERMISSIONS: UserPermissions = {
  calendar: { view: true, edit_rates: false, view_net_b2b: false, can_request_price_change: false },
  mini_rms: 'none',
  settings: { manage_inventory: false, manage_users: false },
};

export const ADMIN_PERMISSIONS: UserPermissions = {
  calendar: { view: true, edit_rates: true, view_net_b2b: true, can_request_price_change: true },
  mini_rms: 'full',
  settings: { manage_inventory: true, manage_users: true },
};

export interface AppUser {
  id: string;
  username: string;
  password: string;
  email: string | null;
  role: Role;
  allowed_hotel_ids: string[]; // ["*"] for admin
  can_access_pu_report: boolean;
  can_upload_pu_only: boolean;
  is_active: boolean;
  created_at: string;
  permissions?: UserPermissions | null;
}

export interface Hotel {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
}

export interface RoomType {
  id: string;
  hotel_id: string;
  name: string;
  display_order: number;
  created_at: string;
}

export interface PriceMatrix {
  id: string;
  hotel_id: string;
  room_type_id: string;
  rate_code: string;
  selling_price: number;
  net_price: number;
  cms_price: number;
  b2b_price: number | null;
}

export interface DailyRate {
  id: string;
  hotel_id: string;
  room_type_id: string;
  date: string; // YYYY-MM-DD
  rate_code: string;
  selling_price: number;
  net_price: number;
  cms_price: number;
  b2b_price: number | null;
  updated_at: string;
}

export interface MasterPriceList {
  id: string;
  hotel_name: string;
  ota_channel: string;
  room_type: string;
  rate_plan: string;
  rate_code: string;
  ref_selling_price: number;
  ref_net_price: number;
  approval_date: string | null;
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface RateChangeRequest {
  id: string;
  hotel_id: string;
  start_date: string | null;
  end_date: string | null;
  date_ranges: DateRange[] | null;
  rate_code: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  created_by_user_id: string | null;
  created_at: string;
  room_type_ids: string[] | null;
  selling_price: number | null;
  net_price: number | null;
  b2b_price: number | null;
  other_text: string | null;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}
