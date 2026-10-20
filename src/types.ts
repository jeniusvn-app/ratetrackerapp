export type Role = 'admin' | 'user';

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
}

export interface Hotel {
  id: string;
  name: string;
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

export interface RateChangeRequest {
  id: string;
  hotel_id: string;
  start_date: string;
  end_date: string;
  rate_code: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  created_by_user_id: string | null;
  created_at: string;
  room_type_ids: string[] | null;
  selling_price: number | null;
  net_price: number | null;
  b2b_price: number | null;
}
