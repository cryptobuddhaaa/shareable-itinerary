export interface Location {
  name: string;
  address: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  mapsUrl?: string;
  placeId?: string;
}

export type EventType = 'meeting' | 'travel' | 'meal' | 'buffer' | 'accommodation' | 'activity' | 'side-event' | 'main-conference';
export type TransitMethod = 'walk' | 'mtr' | 'taxi' | 'bus' | 'airport-express' | 'flight' | 'other';

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  eventId?: string;
}

export interface ItineraryEvent {
  id: string;
  title: string;
  startTime: string; // ISO8601 datetime
  endTime: string; // ISO8601 datetime
  location: Location;
  eventType: EventType;
  description?: string;
  goals?: string[];
  lumaEventUrl?: string;
  notes: string[];
  isOrganized?: boolean; // User is organizing this event
  checklist?: ChecklistItem[];
}

export interface TransitSegment {
  id: string;
  fromEventId: string;
  toEventId: string;
  method: TransitMethod;
  estimatedMinutes: number;
  notes?: string;
  routeDetails?: string;
}

export interface ItineraryDay {
  date: string; // ISO8601 date (YYYY-MM-DD)
  dayNumber: number;
  events: ItineraryEvent[];
  checklist: ChecklistItem[];
  goals: string[];
}

export interface Itinerary {
  id: string;
  title: string;
  description?: string;
  goals?: string; // Overall trip goals
  startDate: string; // ISO8601 date
  endDate: string; // ISO8601 date
  location: string; // Primary location (e.g., "Hong Kong")
  days: ItineraryDay[];
  transitSegments: TransitSegment[];
  metrics?: {
    targetBusinessCards?: number;
    contactsLogged?: number;
    followUpCallsBooked?: number;
  };
  createdByName?: string; // Name of the user who created this itinerary
  createdByEmail?: string; // Email of the user who created this itinerary
  createdAt: string; // ISO8601 datetime
  updatedAt: string; // ISO8601 datetime
}

export interface Contact {
  id: string;
  itineraryId?: string;
  eventId?: string;
  userId: string;
  firstName: string;
  lastName: string;
  projectCompany?: string;
  position?: string;
  telegramHandle?: string;
  email?: string;
  linkedin?: string;
  notes?: string;
  eventTitle?: string; // Denormalized from event for easier display
  lumaEventUrl?: string; // Luma URL from the event (denormalized)
  dateMet?: string; // ISO8601 date
  createdAt: string; // ISO8601 datetime
  updatedAt: string; // ISO8601 datetime
}
