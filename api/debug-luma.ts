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

    return res.status(200).json({
      url,
      jsonLdBlocks,
      metaTags: {
        title: titleMatch ? titleMatch[1] : null,
        description: descMatch ? descMatch[1] : null,
      },
      htmlLength: html.length,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
