// Pure utility / helper functions

/** Escape user-controlled strings for Telegram HTML parse_mode */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Truncate user input to a safe max length before storing */
export function truncateInput(text: string, maxLen = 500): string {
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

/** Validate that a URL uses a safe scheme (http/https only) */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validate and sanitize a Telegram handle for use in tg://resolve URLs */
export function sanitizeHandle(handle: string): string {
  // Only allow alphanumeric + underscores (valid Telegram usernames)
  return handle.replace(/[^a-zA-Z0-9_]/g, '');
}

// --- Validation helpers ---

export function isValidDate(text: string): boolean {
  const trimmed = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const d = new Date(trimmed + 'T00:00:00');
  return !isNaN(d.getTime());
}

export function isValidTime(text: string): boolean {
  const trimmed = text.trim();
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return false;
  const [h, m] = trimmed.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function padTime(text: string): string {
  const [h, m] = text.trim().split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

export function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  }
  const months = Math.floor(diffDays / 30);
  return `${months} month${months !== 1 ? 's' : ''} ago`;
}

// --- Event type options ---

export const EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'meeting', label: '🤝 Meeting' },
  { value: 'activity', label: '🎯 Activity' },
  { value: 'side-event', label: '🎪 Side Event' },
  { value: 'main-conference', label: '🎤 Conference' },
  { value: 'meal', label: '🍽 Meal' },
  { value: 'travel', label: '✈️ Travel' },
  { value: 'accommodation', label: '🏨 Accommodation' },
  { value: 'buffer', label: '⏳ Buffer' },
];

export const EVENT_TYPE_KEYBOARD = [
  [
    { text: '🤝 Meeting', callback_data: 'xt:meeting' },
    { text: '🎯 Activity', callback_data: 'xt:activity' },
  ],
  [
    { text: '🎪 Side Event', callback_data: 'xt:side-event' },
    { text: '🎤 Conference', callback_data: 'xt:main-conference' },
  ],
  [
    { text: '🍽 Meal', callback_data: 'xt:meal' },
    { text: '✈️ Travel', callback_data: 'xt:travel' },
  ],
  [
    { text: '🏨 Accommodation', callback_data: 'xt:accommodation' },
    { text: '⏳ Buffer', callback_data: 'xt:buffer' },
  ],
];

export function getEventTypeLabel(value: string): string {
  return EVENT_TYPE_OPTIONS.find((o) => o.value === value)?.label || value;
}
