import { createClient } from '@supabase/supabase-js';
import type { ItineraryDay, TransitSegment } from '../models/types';

// These will come from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** JSON payload stored in the itinerary `data` column */
export interface ItineraryJsonData {
  days: ItineraryDay[];
  transitSegments: TransitSegment[];
}

// Database types
export interface Database {
  public: {
    Tables: {
      itineraries: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          start_date: string;
          end_date: string;
          location: string;
          data: ItineraryJsonData;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string | null;
          start_date: string;
          end_date: string;
          location: string;
          data: ItineraryJsonData;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          description?: string | null;
          start_date?: string;
          end_date?: string;
          location?: string;
          data?: ItineraryJsonData;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
