import { z } from 'zod';
import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content to prevent XSS attacks
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [], // Strip all HTML tags
    ALLOWED_ATTR: [], // Strip all attributes
  });
}

/**
 * Sanitize plain text input
 */
export function sanitizeText(text: string): string {
  return sanitizeHtml(text).trim();
}

/**
 * Validation schema for itinerary creation
 */
export const CreateItinerarySchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters')
    .transform(sanitizeText),
  startDate: z.string()
    .refine((date) => !isNaN(Date.parse(date)), 'Invalid start date'),
  endDate: z.string()
    .refine((date) => !isNaN(Date.parse(date)), 'Invalid end date'),
  location: z.string()
    .min(1, 'Location is required')
    .max(500, 'Location must be less than 500 characters')
    .transform(sanitizeText),
}).refine((data) => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  return end > start;
}, {
  message: 'End date must be after start date',
  path: ['endDate'],
}).refine((data) => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  return daysDiff <= 365;
}, {
  message: 'Itinerary cannot exceed 365 days',
  path: ['endDate'],
});

/**
 * Validation schema for event creation
 */
export const CreateEventSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters')
    .transform(sanitizeText),
  startTime: z.string()
    .refine((time) => !isNaN(Date.parse(time)), 'Invalid start time'),
  endTime: z.string()
    .refine((time) => !isNaN(Date.parse(time)), 'Invalid end time'),
  locationName: z.string()
    .min(1, 'Location name is required')
    .max(200, 'Location name must be less than 200 characters')
    .transform(sanitizeText),
  locationAddress: z.string()
    .max(500, 'Location address must be less than 500 characters')
    .optional()
    .transform((val) => val ? sanitizeText(val) : ''),
  eventType: z.enum(['meeting', 'travel', 'meal', 'buffer', 'accommodation', 'activity', 'side-event', 'main-conference']),
  description: z.string()
    .max(1000, 'Description must be less than 1000 characters')
    .optional()
    .transform((val) => val ? sanitizeText(val) : ''),
  goals: z.string()
    .max(1000, 'Goals must be less than 1000 characters')
    .optional()
    .transform((val) => val ? sanitizeText(val) : ''),
  lumaEventUrl: z.string()
    .url('Invalid URL')
    .refine((url) => {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        return hostname === 'lu.ma' || hostname === 'luma.com' ||
               hostname.endsWith('.lu.ma') || hostname.endsWith('.luma.com');
      } catch {
        return false;
      }
    }, 'Only Luma URLs (lu.ma or luma.com) are allowed')
    .optional(),
  isOrganized: z.boolean().optional(),
}).refine((data) => {
  const start = new Date(data.startTime);
  const end = new Date(data.endTime);
  return end > start;
}, {
  message: 'End time must be after start time',
  path: ['endTime'],
});

/**
 * Validation schema for share link ID
 */
export const ShareIdSchema = z.string()
  .min(8, 'Invalid share ID')
  .max(12, 'Invalid share ID')
  .regex(/^[a-z0-9]+$/, 'Share ID must contain only lowercase letters and numbers');

/**
 * Validation schema for URL data parameter
 */
export const CompressedDataSchema = z.string()
  .max(100000, 'Compressed data is too large');

/**
 * Sanitize and validate a location object
 */
export function sanitizeLocation(location: { name: string; address?: string; }) {
  return {
    name: sanitizeText(location.name).slice(0, 200),
    address: location.address ? sanitizeText(location.address).slice(0, 500) : undefined,
  };
}

/**
 * Validate Luma URL
 */
export function isValidLumaUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    return hostname === 'lu.ma' || hostname === 'luma.com' ||
           hostname.endsWith('.lu.ma') || hostname.endsWith('.luma.com');
  } catch {
    return false;
  }
}

/**
 * Extract LinkedIn handle from either handle or full URL
 * Accepts: "hsuchuanli" or "https://linkedin.com/in/hsuchuanli/"
 * Returns: "hsuchuanli"
 */
export function extractLinkedInHandle(input: string): string {
  if (!input) return '';

  // If it's a URL, extract the handle
  try {
    const url = new URL(input);
    const pathname = url.pathname;
    // Match patterns like /in/handle/ or /in/handle
    const match = pathname.match(/\/in\/([^/]+)/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    // Not a valid URL, treat as handle
  }

  // Clean up any leading/trailing slashes or whitespace
  return input.replace(/^\/+|\/+$/g, '').trim();
}

/**
 * Validation schema for contact creation
 */
export const CreateContactSchema = z.object({
  firstName: z.string()
    .min(1, 'First name is required')
    .max(100, 'First name must be less than 100 characters')
    .transform(sanitizeText),
  lastName: z.string()
    .min(1, 'Last name is required')
    .max(100, 'Last name must be less than 100 characters')
    .transform(sanitizeText),
  projectCompany: z.string()
    .max(200, 'Project/Company must be less than 200 characters')
    .optional()
    .transform((val) => val ? sanitizeText(val) : undefined),
  position: z.string()
    .max(200, 'Position must be less than 200 characters')
    .optional()
    .transform((val) => val ? sanitizeText(val) : undefined),
  telegramHandle: z.string()
    .max(100, 'Telegram handle must be less than 100 characters')
    .optional()
    .transform((val) => val ? sanitizeText(val) : undefined),
  email: z.string()
    .email('Invalid email address')
    .max(200, 'Email must be less than 200 characters')
    .optional()
    .or(z.literal(''))
    .transform((val) => val && val !== '' ? sanitizeText(val) : undefined),
  linkedin: z.string()
    .max(200, 'LinkedIn must be less than 200 characters')
    .optional()
    .transform((val) => val ? sanitizeText(val) : undefined),
  notes: z.string()
    .max(100, 'Notes must be less than 100 characters')
    .optional()
    .transform((val) => val ? sanitizeText(val) : undefined),
});
