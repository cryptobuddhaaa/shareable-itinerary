/**
 * Vercel Serverless Function: Fetch Luma events from Google Calendar
 * POST /api/google-calendar/luma-events
 *
 * Queries ALL calendars in the user's account (not just primary).
 * Filters Google Calendar events to only return those from Luma.
 * Detection methods (any match = Luma event):
 *   1. Organizer email is calendar-invite@lu.ma or contains lu.ma
 *   2. Any attendee has an @lu.ma email address
 *   3. Description contains a lu.ma or luma.com URL/reference
 *   4. Location contains a lu.ma or luma.com URL/reference
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';

interface GoogleCalendarItem {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  organizer?: { email: string; displayName?: string };
  htmlLink?: string;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
}

interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
}

// Matches any luma.com path or lu.ma short links
const LUMA_URL_PATTERN = /https?:\/\/(?:(?:www\.)?luma\.com\/|lu\.ma\/)/i;
// Simple substring check as a fallback
const LUMA_DOMAIN_PATTERN = /(?:lu\.ma|luma\.com)\//i;

function isLumaEvent(event: GoogleCalendarItem): boolean {
  // Check 1: organizer email from lu.ma
  const organizerEmail = event.organizer?.email?.toLowerCase() || '';
  if (organizerEmail.includes('lu.ma')) {
    return true;
  }

  // Check 2: any attendee has an @lu.ma email
  if (event.attendees?.some((a) => a.email?.toLowerCase().endsWith('@lu.ma'))) {
    return true;
  }

  // Check 3: description contains a Luma URL or domain reference
  if (event.description && (LUMA_URL_PATTERN.test(event.description) || LUMA_DOMAIN_PATTERN.test(event.description))) {
    return true;
  }

  // Check 4: location contains a Luma URL
  if (event.location && (LUMA_URL_PATTERN.test(event.location) || LUMA_DOMAIN_PATTERN.test(event.location))) {
    return true;
  }

  return false;
}

async function fetchEventsFromCalendar(
  calendarId: string,
  accessToken: string,
  timeMin?: string,
  timeMax?: string
): Promise<GoogleCalendarItem[]> {
  const calendarApiUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  );

  calendarApiUrl.searchParams.append('maxResults', '2500');
  calendarApiUrl.searchParams.append('singleEvents', 'true');
  calendarApiUrl.searchParams.append('orderBy', 'startTime');

  if (timeMin) {
    calendarApiUrl.searchParams.append('timeMin', timeMin);
  }
  if (timeMax) {
    calendarApiUrl.searchParams.append('timeMax', timeMax);
  }

  const response = await fetch(calendarApiUrl.toString(), {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    // Log but don't fail — some calendars may not be accessible
    console.warn(`Failed to fetch events from calendar ${calendarId}: ${response.status}`);
    return [];
  }

  const data = await response.json();
  return data.items || [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  try {
    const { accessToken, timeMin, timeMax } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    // Step 1: Get list of all calendars
    const calendarListResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!calendarListResponse.ok) {
      const error = await calendarListResponse.text();
      console.error('Calendar list API error:', error);

      if (calendarListResponse.status === 401) {
        return res.status(401).json({
          error: 'Access token expired or invalid. Please reconnect.',
        });
      }

      return res.status(500).json({ error: 'Failed to fetch calendar list' });
    }

    const calendarListData = await calendarListResponse.json();
    const calendars: CalendarListEntry[] = calendarListData.items || [];

    // Step 2: Fetch events from all calendars in parallel
    const eventsByCalendar = await Promise.all(
      calendars.map(async (cal) => {
        const events = await fetchEventsFromCalendar(cal.id, accessToken, timeMin, timeMax);
        return { calendarId: cal.id, calendarName: cal.summary, events };
      })
    );

    // Step 3: Merge all events, deduplicate by event ID
    const seenIds = new Set<string>();
    const allEvents: GoogleCalendarItem[] = [];
    const calendarSources: string[] = [];

    for (const { calendarName, events } of eventsByCalendar) {
      if (events.length > 0) {
        calendarSources.push(`${calendarName} (${events.length})`);
      }
      for (const event of events) {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          allEvents.push(event);
        }
      }
    }

    // Step 4: Filter to only Luma events
    const lumaEvents = allEvents.filter(isLumaEvent);

    return res.status(200).json({
      events: lumaEvents,
      meta: {
        calendarsQueried: calendars.length,
        totalCalendarEvents: allEvents.length,
        lumaEventsFound: lumaEvents.length,
      },
    });
  } catch (error) {
    console.error('Error in luma-events:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
