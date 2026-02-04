import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.query;

  // Validate the URL parameter
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid url parameter' });
  }

  // Validate it's actually a Luma URL
  if (!url.includes('lu.ma') && !url.includes('luma.com')) {
    return res.status(400).json({ error: 'URL must be from lu.ma or luma.com' });
  }

  try {
    // Fetch the Luma page server-side (no CORS restrictions)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ItineraryBot/1.0)',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to fetch: ${response.statusText}`
      });
    }

    const html = await response.text();

    // Parse the HTML to extract event data
    const eventData = parseEventHtml(html);

    if (!eventData) {
      return res.status(404).json({
        error: 'Could not extract event data from page'
      });
    }

    // Return the parsed event data
    return res.status(200).json(eventData);
  } catch (error) {
    console.error('Error fetching Luma event:', error);
    return res.status(500).json({
      error: 'Failed to fetch event data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

interface LumaEventData {
  title: string;
  startTime?: string;
  endTime?: string;
  location: {
    name: string;
    address?: string;
  };
  description?: string;
}

function parseEventHtml(html: string): LumaEventData | null {
  try {
    // Extract Open Graph meta tags
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);

    // Extract JSON-LD structured data
    const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json">(.+?)<\/script>/s);

    let eventData: LumaEventData | null = null;

    if (jsonLdMatch) {
      try {
        const jsonData = JSON.parse(jsonLdMatch[1]);

        if (jsonData['@type'] === 'Event') {
          eventData = {
            title: jsonData.name || (titleMatch ? titleMatch[1] : ''),
            startTime: jsonData.startDate,
            endTime: jsonData.endDate,
            location: {
              name: jsonData.location?.name || '',
              address: jsonData.location?.address?.streetAddress || '',
            },
            description: jsonData.description || (descMatch ? descMatch[1] : ''),
          };
        }
      } catch (e) {
        // Fall through to Open Graph parsing
      }
    }

    // Fallback to Open Graph data if JSON-LD parsing failed
    if (!eventData && titleMatch) {
      // Try to extract location from page
      const locationMatch = html.match(/<meta\s+property="event:location"\s+content="([^"]+)"/i) ||
                           html.match(/<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)</i);

      eventData = {
        title: titleMatch[1],
        location: {
          name: locationMatch ? locationMatch[1] : '',
        },
        description: descMatch ? descMatch[1] : undefined,
      };
    }

    return eventData;
  } catch (error) {
    console.error('Error parsing event HTML:', error);
    return null;
  }
}
