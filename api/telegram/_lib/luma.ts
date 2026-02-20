// Luma URL parsing and event fetching

import type { LumaEventData } from './types';

export const LUMA_URL_REGEX = /https?:\/\/(?:lu\.ma\/[^\s<>)]+|(?:www\.)?luma\.com\/(?:event\/)?[^\s<>)]+)/gi;

export function extractLumaUrls(text: string): string[] {
  const matches = text.match(LUMA_URL_REGEX);
  if (!matches) return [];
  // Deduplicate and clean (strip trailing punctuation)
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;!?)]+$/, '');
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }
  return urls;
}

export async function fetchLumaEvent(lumaUrl: string): Promise<LumaEventData | null> {
  try {
    // Fetch Luma page directly (server-side, no CORS) instead of calling /api/fetch-luma
    // which requires auth that the webhook handler doesn't have
    const response = await fetch(lumaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ShareableItinerary/1.0)',
        'Accept': 'text/html',
      },
    });
    if (!response.ok) return null;
    const html = await response.text();

    // Parse JSON-LD from the HTML
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (!jsonLdMatch) return null;
    const jsonLd = JSON.parse(jsonLdMatch[1]) as Record<string, unknown>;

    const title = (jsonLd.name as string) || '';
    if (!title) return null;

    const loc = jsonLd.location as Record<string, unknown> | undefined;
    const locName = (loc?.name as string) || '';
    const addr = loc?.address as Record<string, unknown> | string | undefined;
    const locAddress = typeof addr === 'string' ? addr : (addr?.streetAddress as string) || '';

    return {
      title,
      startTime: (jsonLd.startDate as string) || undefined,
      endTime: (jsonLd.endDate as string) || undefined,
      location: { name: locName, address: locAddress },
    };
  } catch {
    return null;
  }
}
