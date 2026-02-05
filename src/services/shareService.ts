import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { supabase } from '../lib/supabase';
import type { Itinerary } from '../models/types';
import { ShareIdSchema, CompressedDataSchema } from '../lib/validation';

export const shareService = {
  /**
   * Compress itinerary to URL-safe string (legacy method for backwards compatibility)
   */
  compressItinerary(itinerary: Itinerary): string {
    const json = JSON.stringify(itinerary);
    return compressToEncodedURIComponent(json);
  },

  /**
   * Decompress URL-safe string to itinerary (legacy method for backwards compatibility)
   */
  decompressItinerary(compressed: string): Itinerary | null {
    try {
      const json = decompressFromEncodedURIComponent(compressed);
      if (!json) return null;
      return JSON.parse(json) as Itinerary;
    } catch (error) {
      console.error('Failed to decompress itinerary:', error);
      return null;
    }
  },

  /**
   * Generate a secure random share ID (12 characters for better security)
   * 12 chars = 36^12 = 4.7 × 10^18 combinations (much harder to guess)
   */
  generateShareId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  /**
   * Generate shareable URL with database-backed short link
   */
  async generateShareUrl(itinerary: Itinerary): Promise<string> {
    try {
      // Check if a share link already exists for this itinerary
      const { data: existing, error: fetchError } = await supabase
        .from('shared_itineraries')
        .select('id')
        .eq('itinerary_id', itinerary.id)
        .single();

      let shareId: string;

      if (existing && !fetchError) {
        // Use existing share link
        shareId = existing.id;
      } else {
        // Create new share link
        shareId = this.generateShareId();

        const { error: insertError } = await supabase
          .from('shared_itineraries')
          .insert({
            id: shareId,
            itinerary_id: itinerary.id,
          });

        if (insertError) {
          console.error('Failed to create share link:', insertError);
          // Fallback to legacy compressed URL method
          const compressed = this.compressItinerary(itinerary);
          const baseUrl = window.location.origin + window.location.pathname;
          return `${baseUrl}?data=${compressed}`;
        }
      }

      const baseUrl = window.location.origin + window.location.pathname;
      return `${baseUrl}?share=${shareId}`;
    } catch (error) {
      console.error('Failed to generate share URL:', error);
      // Fallback to legacy compressed URL method
      const compressed = this.compressItinerary(itinerary);
      const baseUrl = window.location.origin + window.location.pathname;
      return `${baseUrl}?data=${compressed}`;
    }
  },

  /**
   * Load itinerary from URL parameters
   * Supports both new database-backed shares (?share=abc123) and legacy compressed URLs (?data=...)
   */
  async loadFromUrl(): Promise<Itinerary | null> {
    const params = new URLSearchParams(window.location.search);

    // Check for new share link format first
    const shareIdRaw = params.get('share');
    if (shareIdRaw) {
      try {
        // Validate share ID format (prevents injection and DoS)
        const shareId = ShareIdSchema.parse(shareIdRaw);

        // Fetch the shared itinerary from database
        const { data: sharedLink, error: shareError } = await supabase
          .from('shared_itineraries')
          .select('itinerary_id')
          .eq('id', shareId)
          .single();

        if (shareError || !sharedLink) {
          console.error('Share link not found:', shareError);
          return null;
        }

        // Fetch the actual itinerary with all its data
        const { data: itineraryData, error: itineraryError } = await supabase
          .from('itineraries')
          .select(`
            id,
            title,
            location,
            start_date,
            end_date,
            data,
            created_by_name,
            created_by_email,
            created_at,
            updated_at
          `)
          .eq('id', sharedLink.itinerary_id)
          .single();

        if (itineraryError || !itineraryData) {
          console.error('Itinerary not found:', itineraryError);
          return null;
        }

        // TODO: Increment view count (requires SQL function or fetch-then-update)
        // Skipping for now to avoid build errors

        // Transform database format to app format
        const itinerary: Itinerary = {
          id: itineraryData.id,
          title: itineraryData.title,
          location: itineraryData.location,
          startDate: itineraryData.start_date,
          endDate: itineraryData.end_date,
          days: itineraryData.data.days || [],
          transitSegments: itineraryData.data.transitSegments || [],
          createdByName: itineraryData.created_by_name || 'Unknown',
          createdByEmail: itineraryData.created_by_email,
          createdAt: itineraryData.created_at,
          updatedAt: itineraryData.updated_at,
        };

        return itinerary;
      } catch (error) {
        console.error('Failed to load shared itinerary:', error);
        return null;
      }
    }

    // Fall back to legacy compressed URL format
    const dataRaw = params.get('data');
    if (!dataRaw) return null;

    try {
      // Validate compressed data size (prevents DoS)
      const data = CompressedDataSchema.parse(dataRaw);
      return this.decompressItinerary(data);
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
