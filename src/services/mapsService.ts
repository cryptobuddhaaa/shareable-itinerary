import type { Location } from '../models/types';

export const mapsService = {
  /**
   * Generate Google Maps URL for a location
   * Works on all devices - mobile will open in Google Maps app if installed
   */
  generateMapsUrl(location: Location): string {
    if (location.coordinates) {
      // Use coordinates if available (most accurate)
      const { lat, lng } = location.coordinates;
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    } else if (location.placeId) {
      // Use place ID if available
      return `https://www.google.com/maps/search/?api=1&query_place_id=${location.placeId}`;
    } else {
      // Use address or name as search query
      const query = location.address || location.name;
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    }
  },

  /**
   * Generate directions URL between two locations
   * Mobile-friendly - opens in Maps app on mobile devices
   */
  generateDirectionsUrl(origin: Location, destination: Location): string {
    const originQuery = this.locationToQuery(origin);
    const destQuery = this.locationToQuery(destination);
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originQuery)}&destination=${encodeURIComponent(destQuery)}`;
  },

  /**
   * Convert location to query string for Google Maps
   */
  locationToQuery(location: Location): string {
    if (location.coordinates) {
      return `${location.coordinates.lat},${location.coordinates.lng}`;
    }
    return location.address || location.name;
  },

  /**
   * Geocode address to coordinates using browser Geolocation API
   * Note: This is a fallback - for production, use Google Geocoding API
   */
  async geocodeAddress(_address: string): Promise<{ lat: number; lng: number } | null> {
    // This would require Google Geocoding API in production
    // For MVP, we'll store the address and generate maps URLs without coordinates
    console.log('Geocoding not implemented yet - would require Google Geocoding API');
    return null;
  },

  /**
   * Estimate transit time between two locations
   * This is a simple estimation based on distance
   * For production, use Google Directions API
   */
  estimateTransitTime(origin: Location, destination: Location): number {
    // Simple estimation: if both locations have addresses, assume they're close
    // Return time in minutes

    // This is a placeholder - real implementation would use Google Directions API
    if (origin.name === destination.name) {
      return 0; // Same location
    }

    // Default estimate: 20 minutes for different locations
    return 20;
  },

  /**
   * Check if location is likely in the same city/area
   */
  isSameArea(location1: Location, location2: Location): boolean {
    const addr1 = location1.address?.toLowerCase() || '';
    const addr2 = location2.address?.toLowerCase() || '';

    if (!addr1 || !addr2) return false;

    // Simple check: if addresses share city or district names
    const commonWords = ['hong kong', 'central', 'wan chai', 'causeway bay', 'sheung wan'];

    for (const word of commonWords) {
      if (addr1.includes(word) && addr2.includes(word)) {
        return true;
      }
    }

    return false;
  },

  /**
   * Format address for display (mobile-friendly)
   */
  formatAddress(location: Location): string {
    if (location.address) {
      return `${location.name}, ${location.address}`;
    }
    return location.name;
  },

  /**
   * Open location in maps (mobile-friendly)
   * On mobile, this will open the native Maps app
   */
  openInMaps(location: Location): void {
    const url = this.generateMapsUrl(location);
    window.open(url, '_blank');
  },
};
