import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Debug endpoint to see raw HTML from Luma page
 * Usage: /api/debug-luma?url=https://lu.ma/your-event
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ItineraryBot/1.0)',
      },
    });

    const html = await response.text();

    // Extract all JSON-LD blocks
    const jsonLdMatches = [...html.matchAll(/<script\s+type="application\/ld\+json"[^>]*>(.+?)<\/script>/gs)];
    const jsonLdBlocks = jsonLdMatches.map((match, index) => {
      try {
        return {
          index,
          parsed: JSON.parse(match[1]),
          raw: match[1].substring(0, 500), // First 500 chars
        };
      } catch (e) {
        return {
          index,
          error: 'Failed to parse',
          raw: match[1].substring(0, 500),
        };
      }
    });

    // Extract meta tags
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);

    // Look for Next.js data in script tags (Luma uses Next.js)
    const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
    let nextData = null;
    if (nextDataMatch) {
      try {
        nextData = JSON.parse(nextDataMatch[1]);
        // Extract just the event-related data if it exists
        const eventData = nextData?.props?.pageProps?.initialData?.event;
        if (eventData) {
          nextData = {
            eventName: eventData.name,
            startAt: eventData.start_at,
            endAt: eventData.end_at,
            timezone: eventData.timezone,
            location: eventData.geo_address_json,
            eventUrl: eventData.url,
          };
        }
      } catch (e) {
        nextData = { error: 'Failed to parse Next.js data' };
      }
    }

    // Look for time/date patterns in HTML
    const timePatterns = [
      html.match(/<time[^>]*datetime="([^"]+)"/i),
      html.match(/start_at['":\s]+["']([^"']+)["']/i),
      html.match(/startDate['":\s]+["']([^"']+)["']/i),
    ].filter(Boolean);

    return res.status(200).json({
      url,
      jsonLdBlocks,
      nextData,
      metaTags: {
        title: titleMatch ? titleMatch[1] : null,
        description: descMatch ? descMatch[1] : null,
      },
      timePatterns: timePatterns.map(m => m?.[1]),
      htmlLength: html.length,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
