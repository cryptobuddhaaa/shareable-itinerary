/**
 * Google Calendar Service
 * Handles Google Calendar API integration for importing Luma events
 */

import type { ItineraryEvent } from '../models/types';
import { authFetch } from '../lib/authFetch';

export interface LumaEventsMetaInfo {
  calendarsQueried: number;
  totalCalendarEvents: number;
  lumaEventsFound: number;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  location?: string;
  organizer?: {
    email: string;
    displayName?: string;
  };
  htmlLink?: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
}

class GoogleCalendarService {
  private clientId: string;
  private redirectUri: string;
  private scopes = ['https://www.googleapis.com/auth/calendar.readonly'];

  constructor() {
    this.clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
    this.redirectUri = import.meta.env.VITE_GOOGLE_REDIRECT_URI || `${window.location.origin}/auth/google/callback`;
  }

  /**
   * Initiates Google OAuth flow
   */
  initiateOAuth(): void {
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.append('client_id', this.clientId);
    authUrl.searchParams.append('redirect_uri', this.redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', this.scopes.join(' '));
    authUrl.searchParams.append('access_type', 'offline');
    authUrl.searchParams.append('prompt', 'consent');

    // Store the current itinerary ID in session storage for the callback
    const currentPath = window.location.pathname;
    sessionStorage.setItem('google_oauth_return_path', currentPath);

    window.location.href = authUrl.toString();
  }

  /**
   * Exchanges authorization code for access token (server-side)
   */
  async exchangeCodeForToken(code: string): Promise<{ accessToken: string }> {
    const response = await authFetch('/api/google-calendar/exchange-token', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      throw new Error('Failed to exchange code for token');
    }

    return response.json();
  }

  /**
   * Fetches Luma events from Google Calendar
   */
  async fetchLumaEvents(
    accessToken: string,
    timeMin?: string,
    timeMax?: string
  ): Promise<{ events: GoogleCalendarEvent[]; meta?: LumaEventsMetaInfo }> {
    const response = await authFetch('/api/google-calendar/luma-events', {
      method: 'POST',
      body: JSON.stringify({
        accessToken,
        timeMin,
        timeMax,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch Luma events');
    }

    const data = await response.json();
    return {
      events: data.events || [],
      meta: data.meta,
    };
  }

  /**
   * Converts Google Calendar event to our ItineraryEvent format (camelCase)
   */
  convertToItineraryEvent(gcalEvent: GoogleCalendarEvent): ItineraryEvent {
    const startTime = gcalEvent.start.dateTime || gcalEvent.start.date || '';
    const endTime = gcalEvent.end.dateTime || gcalEvent.end.date || '';

    // Extract Luma URL from description if present (lu.ma/..., luma.com/event/..., www.luma.com/event/...)
    let lumaEventUrl: string | undefined;
    if (gcalEvent.description) {
      const lumaUrlMatch = gcalEvent.description.match(/https?:\/\/(?:lu\.ma\/[^\s<>)]+|(?:www\.)?luma\.com\/event\/[^\s<>)]+)/);
      if (lumaUrlMatch) {
        lumaEventUrl = lumaUrlMatch[0];
      }
    }

    return {
      id: gcalEvent.id,
      title: gcalEvent.summary,
      startTime,
      endTime,
      eventType: 'side-event',
      location: gcalEvent.location
        ? { name: gcalEvent.location, address: gcalEvent.location }
        : { name: '', address: '' },
      description: gcalEvent.description || '',
      lumaEventUrl,
      notes: [],
    };
  }

  /**
   * Stores access token securely (in memory for this session)
   * In production, this should be encrypted and stored securely
   */
  storeAccessToken(accessToken: string): void {
    sessionStorage.setItem('google_calendar_access_token', accessToken);
  }

  /**
   * Gets stored access token
   */
  getAccessToken(): string | null {
    return sessionStorage.getItem('google_calendar_access_token');
  }

  /**
   * Clears stored tokens (logout)
   */
  clearTokens(): void {
    sessionStorage.removeItem('google_calendar_access_token');
    sessionStorage.removeItem('google_calendar_refresh_token');
  }

  /**
   * Checks if user is connected to Google Calendar
   */
  isConnected(): boolean {
    return !!this.getAccessToken();
  }
}

export const googleCalendarService = new GoogleCalendarService();
