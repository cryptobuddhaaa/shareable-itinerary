/**
 * Vercel Serverless Function: Fetch Luma events from Google Calendar
 * POST /api/google-calendar/luma-events
 *
 * Filters Google Calendar events to only return those organized by Luma
 * (organizer email: calendar-invite@lu.ma)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const LUMA_ORGANIZER_EMAIL = 'calendar-invite@lu.ma';

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
    const allEvents = data.items || [];

    // Filter to only Luma events (organizer email matches)
    const lumaEvents = allEvents.filter((event: any) => {
      const organizerEmail = event.organizer?.email?.toLowerCase();
      const isLuma = organizerEmail === LUMA_ORGANIZER_EMAIL.toLowerCase();

      // Also try matching if organizer email contains 'lu.ma'
      const isLumaVariant = organizerEmail?.includes('lu.ma');

      return isLuma || isLumaVariant;
    });



    return res.status(200).json(lumaEvents);
  } catch (error) {
    console.error('Error in luma-events:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
