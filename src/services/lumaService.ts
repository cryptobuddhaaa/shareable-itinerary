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
   * Fetch event data from Luma URL
   * Note: Due to CORS restrictions, this may not work directly from the browser.
   * In production, you'd need a CORS proxy or server-side endpoint.
   */
  async fetchEventData(lumaUrl: string): Promise<LumaEventData | null> {
    if (!this.isLumaUrl(lumaUrl)) {
      throw new Error('Invalid Luma URL');
    }

    try {
      // Attempt to fetch the page
      // Note: This will likely fail due to CORS in browser
      const response = await fetch(lumaUrl, {
        method: 'GET',
        mode: 'cors',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Luma event');
      }

      const html = await response.text();
      return this.parseEventHtml(html);
    } catch (error) {
      console.error('Error fetching Luma event:', error);

      // Fallback: Try to extract event ID and use og:meta tags if available
      // or return null to let user fill manually
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
      let eventData: any = {};

      if (jsonLd) {
        try {
          eventData = JSON.parse(jsonLd.textContent || '{}');
        } catch (e) {
          console.error('Failed to parse JSON-LD:', e);
        }
      }

      // Extract event details
      const startTime = eventData.startDate || '';
      const endTime = eventData.endDate || '';
      const locationName = eventData.location?.name || '';
      const locationAddress = eventData.location?.address?.streetAddress || '';

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
