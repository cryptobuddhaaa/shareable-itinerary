import { compress, decompress } from 'lz-string';
import type { Itinerary } from '../models/types';

export const shareService = {
  /**
   * Compress itinerary to URL-safe string
   */
  compressItinerary(itinerary: Itinerary): string {
    const json = JSON.stringify(itinerary);
    return compress(json);
  },

  /**
   * Decompress URL-safe string to itinerary
   */
  decompressItinerary(compressed: string): Itinerary | null {
    try {
      const json = decompress(compressed);
      if (!json) return null;
      return JSON.parse(json) as Itinerary;
    } catch (error) {
      console.error('Failed to decompress itinerary:', error);
      return null;
    }
  },

  /**
   * Generate shareable URL with compressed itinerary
   */
  generateShareUrl(itinerary: Itinerary): string {
    const compressed = this.compressItinerary(itinerary);
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?data=${encodeURIComponent(compressed)}`;
  },

  /**
   * Load itinerary from URL parameters
   */
  loadFromUrl(): Itinerary | null {
    const params = new URLSearchParams(window.location.search);
    const data = params.get('data');
    if (!data) return null;

    try {
      const decoded = decodeURIComponent(data);
      return this.decompressItinerary(decoded);
    } catch (error) {
      console.error('Failed to load itinerary from URL:', error);
      return null;
    }
  },

  /**
   * Copy text to clipboard
   */
  async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return false;
    }
  },
};
