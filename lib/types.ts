/** Sentinel row types shared across the app. */

export type TripStatus = "active" | "arrived" | "escalated" | "cancelled";
export type ContactTier = "primary" | "secondary";
export type AlertType =
  | "nudge"
  | "alarm"
  | "contact_notify"
  | "sos"
  | "arrived";

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
}

export interface TrustedContact {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relationship: string;
  tier: ContactTier;
  verified: boolean;
  account_id: string | null;
  created_at: string;
}

export interface Trip {
  id: string;
  user_id: string;
  destination_text: string;
  destination_lat: number | null;
  destination_lng: number | null;
  transit_mode: string;
  eta_minutes: number;
  buffer_minutes: number;
  status: TripStatus;
  started_at: string;
  expected_arrival_at: string;
}

export interface TripLocation {
  id: string;
  trip_id: string;
  lat: number;
  lng: number;
  recorded_at: string;
}

export interface Alert {
  id: string;
  trip_id: string | null;
  user_id: string;
  type: AlertType;
  status: "pending" | "sent" | "resolved";
  created_at: string;
  resolved_at: string | null;
}

export interface FcmToken {
  id: string;
  user_id: string;
  token: string;
  platform: string | null;
  created_at: string;
}

/* Generated-style insert rows (columns without DB defaults are required). */

export interface ProfileInsert {
  id: string;
  full_name?: string | null;
  phone?: string | null;
}

export interface TrustedContactInsert {
  user_id: string;
  name: string;
  phone: string;
  relationship: string;
  tier: ContactTier;
  verified?: boolean;
  account_id?: string | null;
}

export interface TripInsert {
  user_id: string;
  destination_text: string;
  destination_lat?: number | null;
  destination_lng?: number | null;
  transit_mode: string;
  eta_minutes: number;
  buffer_minutes: number;
  status?: TripStatus;
  started_at?: string;
  expected_arrival_at?: string;
}

export interface TripLocationInsert {
  trip_id: string;
  lat: number;
  lng: number;
}

export interface AlertInsert {
  trip_id?: string | null;
  user_id: string;
  type: AlertType;
  status?: "pending" | "sent" | "resolved";
}

export interface FcmTokenInsert {
  user_id: string;
  token: string;
  platform?: string | null;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: Partial<Profile>;
        Relationships: [];
      };
      trusted_contacts: {
        Row: TrustedContact;
        Insert: TrustedContactInsert;
        Update: Partial<TrustedContact>;
        Relationships: [];
      };
      trips: {
        Row: Trip;
        Insert: TripInsert;
        Update: Partial<Trip>;
        Relationships: [];
      };
      trip_locations: {
        Row: TripLocation;
        Insert: TripLocationInsert;
        Update: Partial<TripLocation>;
        Relationships: [];
      };
      alerts: {
        Row: Alert;
        Insert: AlertInsert;
        Update: Partial<Alert>;
        Relationships: [];
      };
      fcm_tokens: {
        Row: FcmToken;
        Insert: FcmTokenInsert;
        Update: Partial<FcmToken>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}