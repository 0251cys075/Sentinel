export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; full_name: string | null; phone: string | null; created_at: string };
        Insert: { id: string; full_name?: string | null; phone?: string | null; created_at?: string };
        Update: { id?: string; full_name?: string | null; phone?: string | null; created_at?: string };
      };
      trusted_contacts: {
        Row: { id: string; user_id: string; name: string; phone: string; email: string | null; relationship: string; tier: 'primary' | 'secondary'; verified: boolean; pending_verification_code: string | null; created_at: string };
        Insert: { id?: string; user_id: string; name: string; phone: string; email?: string | null; relationship?: string; tier?: 'primary' | 'secondary'; verified?: boolean; pending_verification_code?: string | null; created_at?: string };
        Update: { id?: string; user_id?: string; name?: string; phone?: string; email?: string | null; relationship?: string; tier?: 'primary' | 'secondary'; verified?: boolean; pending_verification_code?: string | null; created_at?: string };
      };
      trips: {
        Row: { id: string; user_id: string; destination_text: string; destination_lat: number | null; destination_lng: number | null; transit_mode: string; eta_minutes: number; buffer_minutes: number; status: 'active' | 'arrived' | 'escalated' | 'cancelled'; started_at: string; expected_arrival_at: string };
        Insert: { id?: string; user_id: string; destination_text?: string; destination_lat?: number | null; destination_lng?: number | null; transit_mode?: string; eta_minutes?: number; buffer_minutes?: number; status?: 'active' | 'arrived' | 'escalated' | 'cancelled'; started_at?: string; expected_arrival_at: string };
        Update: { id?: string; user_id?: string; destination_text?: string; destination_lat?: number | null; destination_lng?: number | null; transit_mode?: string; eta_minutes?: number; buffer_minutes?: number; status?: 'active' | 'arrived' | 'escalated' | 'cancelled'; started_at?: string; expected_arrival_at?: string };
      };
      trip_locations: {
        Row: { id: string; trip_id: string; lat: number; lng: number; recorded_at: string; speed_kmh: number | null; heading: number | null; travel_mode: string | null };
        Insert: { id?: string; trip_id: string; lat: number; lng: number; recorded_at?: string; speed_kmh?: number | null; heading?: number | null; travel_mode?: string | null };
        Update: { id?: string; trip_id?: string; lat?: number; lng?: number; recorded_at?: string; speed_kmh?: number | null; heading?: number | null; travel_mode?: string | null };
      };
      alerts: {
        Row: { id: string; trip_id: string; user_id: string; type: 'nudge' | 'alarm' | 'contact_notify' | 'sos' | 'arrived'; status: 'sent' | 'acknowledged' | 'resolved'; created_at: string; resolved_at: string | null };
        Insert: { id?: string; trip_id: string; user_id: string; type: 'nudge' | 'alarm' | 'contact_notify' | 'sos' | 'arrived'; status?: 'sent' | 'acknowledged' | 'resolved'; created_at?: string; resolved_at?: string | null };
        Update: { id?: string; trip_id?: string; user_id?: string; type?: 'nudge' | 'alarm' | 'contact_notify' | 'sos' | 'arrived'; status?: 'sent' | 'acknowledged' | 'resolved'; created_at?: string; resolved_at?: string | null };
      };
    };
  };
}
