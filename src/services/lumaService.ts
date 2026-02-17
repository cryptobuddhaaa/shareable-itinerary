export interface LumaEventData {
  title: string;
  startTime: string;
  endTime: string;
  location: {
    name: string;
    address?: string;
  };
  description?: string;
}

export const lumaService = {
  /**
   * Check if URL is a valid Luma event URL
   */
  isLumaUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('lu.ma') || urlObj.hostname.includes('luma.com');
    } catch {
      return false;
    }
  },

  /**
   * Fetch event data from Luma URL via serverless proxy
   * Uses the /api/fetch-luma endpoint to bypass CORS restrictions
   */
  async fetchEventData(lumaUrl: string): Promise<LumaEventData | null> {
    if (!this.isLumaUrl(lumaUrl)) {
      throw new Error('Invalid Luma URL');
    }

    try {
      // Use our serverless function as a CORS proxy
      const apiUrl = `/api/fetch-luma?url=${encodeURIComponent(lumaUrl)}`;

      const response = await fetch(apiUrl, {
        method: 'GET',
      });

      if (!response.ok) {
        // Check if we're getting HTML/TS source (API not available in dev mode)
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('text/html') || contentType?.includes('typescript')) {
          throw new Error('DEV_MODE_NO_API');
        }

        const errorData = await response.json().catch(() => ({}));
        console.error('API error:', errorData);
        throw new Error(errorData.error || 'Failed to fetch Luma event');
      }

      const eventData = await response.json();
      return eventData;
    } catch (error) {
      console.error('Error fetching Luma event:', error);

      // Check if it's a JSON parsing error (getting non-JSON response)
      if (error instanceof SyntaxError) {
        throw new Error('DEV_MODE_NO_API');
      }

      if (error instanceof Error) {
        throw error;
      }

      return null;
    }
  },

  /**
   * Parse HTML to extract event details
   * Looks for meta tags and structured data
   */
  parseEventHtml(html: string): LumaEventData | null {
    try {
      // Create a DOM parser (works in browser)
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract Open Graph meta tags
      const title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const description = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

      // Try to find location and time in meta tags or JSON-LD
      const jsonLd = doc.querySelector('script[type="application/ld+json"]');
      let eventData: Record<string, unknown> = {};

      if (jsonLd) {
        try {
          eventData = JSON.parse(jsonLd.textContent || '{}');
        } catch (e) {
          console.error('Failed to parse JSON-LD:', e);
        }
      }

      // Extract event details
      const startTime = (eventData.startDate as string) || '';
      const endTime = (eventData.endDate as string) || '';
      const loc = eventData.location as Record<string, unknown> | undefined;
      const locationName = (loc?.name as string) || '';
      const addr = loc?.address as Record<string, unknown> | string | undefined;
      const locationAddress = typeof addr === 'string' ? addr : (addr?.streetAddress as string) || '';

      if (!title) {
        return null;
      }

      return {
        title: title.replace(' | Luma', '').trim(),
        startTime,
        endTime,
        location: {
          name: locationName,
          address: locationAddress,
        },
        description,
      };
    } catch (error) {
      console.error('Error parsing Luma HTML:', error);
      return null;
    }
  },

  /**
   * Extract basic info from Luma URL without fetching
   * This always works and can provide the event ID
   */
  extractEventInfo(lumaUrl: string): { eventId: string; calendarSlug?: string } | null {
    try {
      const url = new URL(lumaUrl);
      const pathname = url.pathname;

      // Luma URLs typically look like: lu.ma/event-slug or lu.ma/calendar/event-slug
      const parts = pathname.split('/').filter(p => p);

      if (parts.length === 1) {
        return { eventId: parts[0] };
      } else if (parts.length === 2) {
        return { calendarSlug: parts[0], eventId: parts[1] };
      }

      return null;
    } catch {
      return null;
    }
  },
};
