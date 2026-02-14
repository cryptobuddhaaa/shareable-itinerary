/**
 * Vercel Serverless Function: Fetch Luma events from Google Calendar
 * POST /api/google-calendar/luma-events
 *
 * Filters Google Calendar events to only return those from Luma.
 * Detection methods (any match = Luma event):
 *   1. Organizer email is calendar-invite@lu.ma or contains lu.ma
 *   2. Any attendee has an @lu.ma email address
 *   3. Description contains a lu.ma, luma.com, or www.luma.com link
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

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

// Matches lu.ma/..., luma.com/event/..., or www.luma.com/event/...
const LUMA_URL_PATTERN = /https?:\/\/(?:(?:www\.)?luma\.com\/event\/|lu\.ma\/)/i;

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

  // Check 3: description contains a Luma URL
  if (event.description && LUMA_URL_PATTERN.test(event.description)) {
    return true;
  }

  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { accessToken, timeMin, timeMax } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    // Build Google Calendar API URL
    const calendarApiUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');

    // Add query parameters
    calendarApiUrl.searchParams.append('maxResults', '2500');
    calendarApiUrl.searchParams.append('singleEvents', 'true');
    calendarApiUrl.searchParams.append('orderBy', 'startTime');

    if (timeMin) {
      calendarApiUrl.searchParams.append('timeMin', timeMin);
    }
    if (timeMax) {
      calendarApiUrl.searchParams.append('timeMax', timeMax);
    }

    // Fetch events from Google Calendar
    const calendarResponse = await fetch(calendarApiUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!calendarResponse.ok) {
      const error = await calendarResponse.text();
      console.error('Google Calendar API error:', error);

      if (calendarResponse.status === 401) {
        return res.status(401).json({
          error: 'Access token expired or invalid. Please reconnect.',
        });
      }

      return res.status(500).json({ error: 'Failed to fetch calendar events' });
    }

    const data = await calendarResponse.json();
    const allEvents: GoogleCalendarItem[] = data.items || [];

    // Filter to only Luma events
    const lumaEvents = allEvents.filter(isLumaEvent);



    return res.status(200).json(lumaEvents);
  } catch (error) {
    console.error('Error in luma-events:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
