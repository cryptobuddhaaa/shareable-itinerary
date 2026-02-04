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

/**
 * Decode HTML entities like &amp;, &lt;, &gt;, &quot;, etc.
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  let decoded = text;

  // Replace named entities
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }

  // Replace numeric entities (&#123; or &#x1A;)
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  return decoded;
}

function parseEventHtml(html: string): LumaEventData | null {
  try {
    // Extract Open Graph meta tags
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);

    // Extract ALL JSON-LD structured data blocks
    const jsonLdMatches = html.matchAll(/<script\s+type="application\/ld\+json"[^>]*>(.+?)<\/script>/gs);

    let eventData: LumaEventData | null = null;

    // Try to find Event schema in any JSON-LD block
    for (const match of jsonLdMatches) {
      try {
        const jsonData = JSON.parse(match[1]);

        // Handle both single Event and array of schemas
        const eventSchema = Array.isArray(jsonData)
          ? jsonData.find((item: any) => item['@type'] === 'Event')
          : (jsonData['@type'] === 'Event' ? jsonData : null);

        if (eventSchema) {
          // Extract location with multiple fallbacks
          let locationName = '';
          let locationAddress = '';

          if (eventSchema.location) {
            if (typeof eventSchema.location === 'string') {
              locationName = eventSchema.location;
            } else if (eventSchema.location.name) {
              locationName = eventSchema.location.name;
              // Try multiple address formats
              locationAddress = eventSchema.location.address?.streetAddress ||
                              eventSchema.location.address?.addressLocality ||
                              (typeof eventSchema.location.address === 'string' ? eventSchema.location.address : '');
            }
          }

          eventData = {
            title: decodeHtmlEntities(eventSchema.name || (titleMatch ? titleMatch[1].replace(' | Luma', '').trim() : '')),
            startTime: eventSchema.startDate || undefined,
            endTime: eventSchema.endDate || undefined,
            location: {
              name: decodeHtmlEntities(locationName),
              address: decodeHtmlEntities(locationAddress),
            },
            description: eventSchema.description ? decodeHtmlEntities(eventSchema.description) : (descMatch ? decodeHtmlEntities(descMatch[1]) : undefined),
          };

          console.log('Parsed event data:', eventData); // Debug log
          break; // Found event data, stop looking
        }
      } catch (e) {
        console.error('Failed to parse JSON-LD block:', e);
        continue; // Try next JSON-LD block
      }
    }

    // Fallback to Open Graph data if JSON-LD parsing failed
    if (!eventData && titleMatch) {
      // Try to extract location and times from various meta tags
      const locationMatch = html.match(/<meta\s+property="event:location"\s+content="([^"]+)"/i) ||
                           html.match(/<meta\s+name="location"\s+content="([^"]+)"/i) ||
                           html.match(/<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)</i);

      const startTimeMatch = html.match(/<meta\s+property="event:start_time"\s+content="([^"]+)"/i) ||
                            html.match(/<time[^>]*datetime="([^"]+)"/i);

      const endTimeMatch = html.match(/<meta\s+property="event:end_time"\s+content="([^"]+)"/i);

      eventData = {
        title: decodeHtmlEntities(titleMatch[1].replace(' | Luma', '').trim()),
        startTime: startTimeMatch ? startTimeMatch[1] : undefined,
        endTime: endTimeMatch ? endTimeMatch[1] : undefined,
        location: {
          name: locationMatch ? decodeHtmlEntities(locationMatch[1]) : '',
        },
        description: descMatch ? decodeHtmlEntities(descMatch[1]) : undefined,
      };

      console.log('Fallback parsed event data:', eventData); // Debug log
    }

    return eventData;
  } catch (error) {
    console.error('Error parsing event HTML:', error);
    return null;
  }
}
