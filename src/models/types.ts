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
  tags?: string[]; // Tag names assigned to this contact (max 3)
  eventTitle?: string; // Denormalized from event for easier display
  lumaEventUrl?: string; // Luma URL from the event (denormalized)
  dateMet?: string; // ISO8601 date
  lastContactedAt?: string | null; // ISO8601 datetime — when user last reached out
  createdAt: string; // ISO8601 datetime
  updatedAt: string; // ISO8601 datetime
}

export interface UserTag {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

export interface ContactNote {
  id: string;
  contactId: string;
  userId: string;
  content: string;
  createdAt: string;
}

// Web3 types

export interface UserWallet {
  id: string;
  userId: string;
  walletAddress: string;
  isPrimary: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

export type HandshakeStatus = 'pending' | 'claimed' | 'matched' | 'minted' | 'expired';

export interface Handshake {
  id: string;
  initiatorUserId: string;
  receiverUserId: string | null;
  receiverIdentifier: string;
  contactId: string | null;
  eventId: string | null;
  eventTitle: string | null;
  eventDate: string | null;
  initiatorWallet: string | null;
  receiverWallet: string | null;
  initiatorMintedAt: string | null;
  receiverMintedAt: string | null;
  status: HandshakeStatus;
  initiatorNftAddress: string | null;
  receiverNftAddress: string | null;
  initiatorTxSignature: string | null;
  receiverTxSignature: string | null;
  pointsAwarded: number;
  mintFeeLamports: number;
  createdAt: string;
  expiresAt: string;
  initiatorName?: string; // Resolved server-side for receiver handshakes (not a DB column)
  initiatorEmail?: string; // Resolved server-side for receiver handshakes (not a DB column)
}

export interface TrustScore {
  userId: string;
  trustScore: number; // 0-100 composite score
  scoreHandshakes: number; // 0-30
  scoreWallet: number; // 0-20
  scoreSocials: number; // 0-20
  scoreEvents: number; // 0-20
  scoreCommunity: number; // 0-10
  telegramPremium: boolean;
  hasUsername: boolean;
  telegramAccountAgeDays: number | null;
  walletConnected: boolean;
  walletAgeDays: number | null;
  walletTxCount: number | null;
  walletHasTokens: boolean;
  xVerified: boolean;
  xPremium: boolean;
  totalHandshakes: number;
  trustLevel: number; // legacy 1-5 (kept for backward compat)
  updatedAt: string;
}

export interface UserProfile {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  bio: string | null;
  twitterHandle: string | null;
  linkedinUrl: string | null;
  website: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
