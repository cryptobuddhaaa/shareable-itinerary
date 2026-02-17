/**
 * Vercel Serverless Function: Telegram Bot Webhook
 * POST /api/telegram/webhook
 *
 * Handles all incoming Telegram updates for the bot.
 * Flows:
 *   /newcontact           → select itinerary → select event → input fields → confirm → save contact
 *   /newitinerary  → title → location → start date → end date → confirm → save itinerary
 *   /newevent      → select itinerary → select day → title → type → start time → end time → location → confirm → save event
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// --- Configuration ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://shareable-itinerary.vercel.app';

// Webhook secret derived from bot token
const WEBHOOK_SECRET = crypto
  .createHash('sha256')
  .update(BOT_TOKEN + ':webhook')
  .digest('hex')
  .substring(0, 32);

// Supabase client with service role (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// --- Types ---
interface BotState {
  state: string;
  data: Record<string, unknown>;
}

interface EventInfo {
  id: string;
  title: string;
  date: string;
}

// --- Validation helpers ---
function isValidDate(text: string): boolean {
  const trimmed = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const d = new Date(trimmed + 'T00:00:00');
  return !isNaN(d.getTime());
}

function isValidTime(text: string): boolean {
  const trimmed = text.trim();
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return false;
  const [h, m] = trimmed.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function padTime(text: string): string {
  const [h, m] = text.trim().split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

// --- Luma helpers ---
const LUMA_URL_REGEX = /https?:\/\/(?:lu\.ma\/[^\s<>)]+|(?:www\.)?luma\.com\/(?:event\/)?[^\s<>)]+)/gi;

function extractLumaUrls(text: string): string[] {
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

interface LumaEventData {
  title: string;
  startTime?: string;
  endTime?: string;
  location: { name: string; address?: string };
  description?: string;
}

async function fetchLumaEvent(lumaUrl: string): Promise<LumaEventData | null> {
  try {
    const apiUrl = `${WEBAPP_URL}/api/fetch-luma?url=${encodeURIComponent(lumaUrl)}`;
    const response = await fetch(apiUrl);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || !data.title) return null;
    return data as LumaEventData;
  } catch {
    return null;
  }
}

// --- Event type options ---
const EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'meeting', label: '🤝 Meeting' },
  { value: 'activity', label: '🎯 Activity' },
  { value: 'side-event', label: '🎪 Side Event' },
  { value: 'main-conference', label: '🎤 Conference' },
  { value: 'meal', label: '🍽 Meal' },
  { value: 'travel', label: '✈️ Travel' },
  { value: 'accommodation', label: '🏨 Accommodation' },
  { value: 'buffer', label: '⏳ Buffer' },
];

const EVENT_TYPE_KEYBOARD = [
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

function getEventTypeLabel(value: string): string {
  return EVENT_TYPE_OPTIONS.find((o) => o.value === value)?.label || value;
}

// --- Telegram API helpers ---
async function sendMessage(
  chatId: number,
  text: string,
  options?: { reply_markup?: object; parse_mode?: string }
) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...options,
    }),
  });
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });
}

// --- State management ---
async function getState(telegramUserId: number): Promise<BotState> {
  const { data } = await supabase
    .from('telegram_bot_state')
    .select('state, data')
    .eq('telegram_user_id', telegramUserId)
    .single();

  return data || { state: 'idle', data: {} };
}

async function setState(
  telegramUserId: number,
  state: string,
  stateData: Record<string, unknown>
) {
  await supabase.from('telegram_bot_state').upsert({
    telegram_user_id: telegramUserId,
    state,
    data: stateData,
    updated_at: new Date().toISOString(),
  });
}

async function clearState(telegramUserId: number) {
  await setState(telegramUserId, 'idle', {});
}

// --- Account linking ---
async function getLinkedUserId(telegramUserId: number): Promise<string | null> {
  const { data } = await supabase
    .from('telegram_links')
    .select('user_id')
    .eq('telegram_user_id', telegramUserId)
    .single();

  return data?.user_id || null;
}

// ============================================================
// CONTACT CREATION FLOW (/newcontact)
// ============================================================

async function handleStart(
  chatId: number,
  telegramUserId: number,
  telegramUsername: string | undefined,
  args: string
) {
  if (!args) {
    const linked = await getLinkedUserId(telegramUserId);
    if (linked) {
      await sendMessage(
        chatId,
        '👋 Welcome back! Your account is linked.\n\n' +
          'Use /newcontact to add a new contact.\n' +
          'Use /newitinerary to create a trip.\n' +
          'Use /newevent to add an event.\n' +
          'Use /help for all commands.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
            ],
          },
        }
      );
    } else {
      await sendMessage(
        chatId,
        '👋 Welcome to Itinerary & Contact Manager!\n\n' +
          'Tap <b>Open App</b> below to get started, or link an existing account from the web app.\n\n' +
          'Use /help for all commands.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
            ],
          },
        }
      );
    }
    return;
  }

  // Code provided — attempt to link account
  const code = args.trim();
  const { data: linkCode } = await supabase
    .from('telegram_link_codes')
    .select('user_id, expires_at, used')
    .eq('code', code)
    .single();

  if (!linkCode || linkCode.used || new Date(linkCode.expires_at) < new Date()) {
    await sendMessage(
      chatId,
      '❌ Invalid or expired link code. Please generate a new one from the web app.'
    );
    return;
  }

  // Upsert the link (handles both new links and re-links)
  await supabase.from('telegram_links').upsert({
    telegram_user_id: telegramUserId,
    user_id: linkCode.user_id,
    telegram_username: telegramUsername || null,
    linked_at: new Date().toISOString(),
  });

  // Mark code as used
  await supabase
    .from('telegram_link_codes')
    .update({ used: true })
    .eq('code', code);

  await sendMessage(
    chatId,
    '✅ Account linked successfully!\n\nUse /newcontact to add a new contact, /newitinerary to create a trip, or /newevent to add an event.'
  );
}

async function handleNewContact(chatId: number, telegramUserId: number) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(
      chatId,
      '❌ Your account is not linked yet.\n\n' +
        'Go to your web app → Contacts → Link Telegram to get started.'
    );
    return;
  }

  // Fetch user's itineraries
  const { data: itineraries } = await supabase
    .from('itineraries')
    .select('id, title, start_date, end_date, location')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
    .limit(10);

  // Build inline keyboard with itineraries + skip option
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  if (itineraries && itineraries.length > 0) {
    for (const it of itineraries) {
      keyboard.push([{
        text: `${it.title} (${it.location})`,
        callback_data: `it:${it.id}`,
      }]);
    }
  }

  // Always offer the option to skip itinerary/event linking
  keyboard.push([{ text: '⏭ Skip — add without event', callback_data: 'it:skip' }]);

  await setState(telegramUserId, 'select_itinerary', {});
  await sendMessage(chatId, '📋 Select an itinerary (or skip):', {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleItinerarySelection(
  chatId: number,
  telegramUserId: number,
  itineraryId: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  // Skip itinerary/event — go straight to contact fields
  if (itineraryId === 'skip') {
    await setState(telegramUserId, 'input_telegram_handle', {
      contact: {},
    });
    await sendMessage(
      chatId,
      '📝 Adding standalone contact\n\n' +
        'Enter their <b>Telegram handle</b> (required):\n' +
        '<i>e.g. @johndoe</i>'
    );
    return;
  }

  // Fetch the itinerary to get events from the data JSON
  const { data: itinerary } = await supabase
    .from('itineraries')
    .select('id, title, data')
    .eq('id', itineraryId)
    .eq('user_id', userId)
    .single();

  if (!itinerary) {
    await sendMessage(chatId, '❌ Itinerary not found.');
    await clearState(telegramUserId);
    return;
  }

  // Extract events from all days
  const itineraryData = itinerary.data as { days?: Array<{ date: string; events?: Array<{ id: string; title: string; startTime: string }> }> };
  const days = itineraryData?.days || [];
  const events: EventInfo[] = [];

  for (const day of days) {
    for (const event of day.events || []) {
      events.push({
        id: event.id,
        title: event.title,
        date: day.date,
      });
    }
  }

  if (events.length === 0) {
    await sendMessage(
      chatId,
      `📅 No events found in "${itinerary.title}". Add events in the web app first.`
    );
    await clearState(telegramUserId);
    return;
  }

  // Build inline keyboard — show date and title for each event
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = events.slice(0, 20).map((ev) => {
    const date = new Date(ev.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const label = `${date} — ${ev.title}`.substring(0, 60);
    return [{ text: label, callback_data: `ev:${ev.id}` }];
  });

  // Option to skip event linking
  keyboard.push([{ text: '⏭ Skip — add without event', callback_data: 'ev:skip' }]);

  await setState(telegramUserId, 'select_event', {
    itineraryId: itinerary.id,
    itineraryTitle: itinerary.title,
    events: events.map((e) => ({ id: e.id, title: e.title, date: e.date })),
  });

  await sendMessage(
    chatId,
    `📅 Select the event from <b>${itinerary.title}</b>:`,
    { reply_markup: { inline_keyboard: keyboard } }
  );
}

async function handleEventSelection(
  chatId: number,
  telegramUserId: number,
  eventId: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const currentState = await getState(telegramUserId);

  // Skip event — keep itinerary info but no event
  if (eventId === 'skip') {
    await setState(telegramUserId, 'input_telegram_handle', {
      itineraryId: currentState.data.itineraryId,
      itineraryTitle: currentState.data.itineraryTitle,
      contact: {},
    });
    await sendMessage(
      chatId,
      '📝 Adding contact (no event)\n\n' +
        'Enter their <b>Telegram handle</b> (required):\n' +
        '<i>e.g. @johndoe</i>'
    );
    return;
  }

  const events = (currentState.data.events as EventInfo[]) || [];
  const selectedEvent = events.find((e) => e.id === eventId);

  if (!selectedEvent) {
    await sendMessage(chatId, '❌ Event not found.');
    await clearState(telegramUserId);
    return;
  }

  await setState(telegramUserId, 'input_telegram_handle', {
    ...currentState.data,
    eventId: selectedEvent.id,
    eventTitle: selectedEvent.title,
    eventDate: selectedEvent.date,
    contact: {},
  });

  await sendMessage(
    chatId,
    `📝 Adding contact to: <b>${selectedEvent.title}</b>\n\n` +
      'Enter their <b>Telegram handle</b> (required):\n' +
      '<i>e.g. @johndoe</i>'
  );
}

// --- Contact field input handlers ---
const FIELD_FLOW: Array<{
  state: string;
  field: string;
  prompt: string;
  required: boolean;
}> = [
  {
    state: 'input_telegram_handle',
    field: 'telegramHandle',
    prompt: 'Enter their <b>Telegram handle</b> (required):\n<i>e.g. @johndoe</i>',
    required: true,
  },
  {
    state: 'input_first_name',
    field: 'firstName',
    prompt: 'Enter their <b>first name</b> (required):\n<i>e.g. John</i>',
    required: true,
  },
  {
    state: 'input_last_name',
    field: 'lastName',
    prompt: 'Enter their <b>last name</b> (optional):',
    required: false,
  },
  {
    state: 'input_company',
    field: 'projectCompany',
    prompt: 'Enter their <b>company / project</b> (optional):',
    required: false,
  },
  {
    state: 'input_position',
    field: 'position',
    prompt: 'Enter their <b>position / role</b> (optional):',
    required: false,
  },
  {
    state: 'input_notes',
    field: 'notes',
    prompt: 'Any <b>notes</b> about this contact? (optional):',
    required: false,
  },
];

function getFieldIndex(state: string): number {
  return FIELD_FLOW.findIndex((f) => f.state === state);
}

/** Transition to the next field in the flow, or show confirmation if done. */
async function goToNextField(
  chatId: number,
  telegramUserId: number,
  stateData: Record<string, unknown>,
  currentIndex: number
) {
  const nextIndex = currentIndex + 1;

  // No more fields → show confirmation
  if (nextIndex >= FIELD_FLOW.length) {
    await showContactConfirmation(chatId, telegramUserId, stateData);
    return;
  }

  const nextField = FIELD_FLOW[nextIndex];
  await setState(telegramUserId, nextField.state, stateData);

  const options: { reply_markup?: object } = {};
  if (!nextField.required) {
    options.reply_markup = {
      inline_keyboard: [[{ text: '⏭ Skip', callback_data: 'skip' }]],
    };
  }

  await sendMessage(chatId, nextField.prompt, options);
}

async function handleContactTextInput(
  chatId: number,
  telegramUserId: number,
  text: string,
  currentState: BotState
) {
  const currentIndex = getFieldIndex(currentState.state);
  if (currentIndex === -1) return false;

  const fieldConfig = FIELD_FLOW[currentIndex];
  const contact = { ...(currentState.data.contact as Record<string, string>) };

  // Store the field value
  if (fieldConfig.field === 'telegramHandle') {
    contact.telegramHandle = text.startsWith('@') ? text : `@${text}`;
  } else {
    contact[fieldConfig.field] = text.trim();
  }

  const updatedData = { ...currentState.data, contact };

  // If editing from confirmation, return to confirmation
  if (currentState.data._editMode) {
    delete (updatedData as Record<string, unknown>)._editMode;
    await showContactConfirmation(chatId, telegramUserId, updatedData);
    return true;
  }

  await goToNextField(chatId, telegramUserId, updatedData, currentIndex);
  return true;
}

async function handleSkip(
  chatId: number,
  telegramUserId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const currentState = await getState(telegramUserId);

  // New event location skip
  if (currentState.state === 'new_ev_location') {
    const updatedData = { ...currentState.data };
    delete updatedData._editMode;
    await showEventConfirmation(chatId, telegramUserId, updatedData);
    return;
  }

  // Contact flow skip
  const currentIndex = getFieldIndex(currentState.state);
  if (currentIndex === -1) return;

  const contact = { ...(currentState.data.contact as Record<string, string>) };

  await goToNextField(chatId, telegramUserId, { ...currentState.data, contact }, currentIndex);
}

/** Handle edit button from confirmation — re-enter a specific field, then return to confirmation. */
async function handleContactEdit(
  chatId: number,
  telegramUserId: number,
  fieldIndex: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  if (fieldIndex < 0 || fieldIndex >= FIELD_FLOW.length) return;

  const currentState = await getState(telegramUserId);
  const field = FIELD_FLOW[fieldIndex];

  // Set state to the edit target field, and remember to return to confirmation after
  await setState(telegramUserId, field.state, {
    ...currentState.data,
    _editMode: true,
  });

  await sendMessage(chatId, `✏️ ${field.prompt}`);
}

// --- Contact Confirmation & Save ---
async function showContactConfirmation(
  chatId: number,
  telegramUserId: number,
  stateData: Record<string, unknown>
) {
  const contact = stateData.contact as Record<string, string>;
  const eventTitle = stateData.eventTitle as string | undefined;
  const itineraryTitle = stateData.itineraryTitle as string | undefined;

  let summary = '<b>📋 Confirm new contact:</b>\n\n';
  if (itineraryTitle && eventTitle) {
    summary += `📍 ${itineraryTitle} → ${eventTitle}\n\n`;
  } else if (itineraryTitle) {
    summary += `📍 ${itineraryTitle}\n\n`;
  } else {
    summary += '📍 Standalone contact\n\n';
  }
  summary += `💬 Telegram: ${contact.telegramHandle}\n`;
  summary += `👤 Name: ${contact.firstName}`;
  if (contact.lastName) summary += ` ${contact.lastName}`;
  summary += '\n';
  if (contact.projectCompany) summary += `🏢 Company: ${contact.projectCompany}\n`;
  if (contact.position) summary += `💼 Position: ${contact.position}\n`;
  if (contact.notes) summary += `📝 Notes: ${contact.notes}\n`;

  await setState(telegramUserId, 'confirm', stateData);

  await sendMessage(chatId, summary, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Confirm', callback_data: 'cf:yes' },
          { text: '❌ Cancel', callback_data: 'cf:no' },
        ],
        [
          { text: '✏️ Telegram', callback_data: 'ed:0' },
          { text: '✏️ First Name', callback_data: 'ed:1' },
          { text: '✏️ Last Name', callback_data: 'ed:2' },
        ],
        [
          { text: '✏️ Company', callback_data: 'ed:3' },
          { text: '✏️ Position', callback_data: 'ed:4' },
          { text: '✏️ Notes', callback_data: 'ed:5' },
        ],
      ],
    },
  });
}

async function handleContactConfirmation(
  chatId: number,
  telegramUserId: number,
  confirmed: boolean,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  if (!confirmed) {
    await clearState(telegramUserId);
    await sendMessage(chatId, '❌ Cancelled. Use /help for commands.');
    return;
  }

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  const currentState = await getState(telegramUserId);
  const contact = currentState.data.contact as Record<string, string>;
  const itineraryId = currentState.data.itineraryId as string | undefined;
  const eventId = currentState.data.eventId as string | undefined;
  const eventTitle = currentState.data.eventTitle as string | undefined;
  const eventDate = currentState.data.eventDate as string | undefined;

  // Look up the event's lumaEventUrl from itinerary data (only if we have both)
  let lumaEventUrl: string | undefined;
  if (itineraryId && eventId) {
    const { data: itinerary } = await supabase
      .from('itineraries')
      .select('data')
      .eq('id', itineraryId)
      .single();

    if (itinerary?.data) {
      const itData = itinerary.data as { days?: Array<{ events?: Array<{ id: string; lumaEventUrl?: string }> }> };
      for (const day of itData.days || []) {
        for (const event of day.events || []) {
          if (event.id === eventId) {
            lumaEventUrl = event.lumaEventUrl;
          }
        }
      }
    }
  }

  // Insert contact into Supabase
  const { error } = await supabase.from('contacts').insert({
    itinerary_id: itineraryId || null,
    event_id: eventId || null,
    user_id: userId,
    first_name: contact.firstName,
    last_name: contact.lastName || '',
    project_company: contact.projectCompany || null,
    position: contact.position || null,
    telegram_handle: contact.telegramHandle,
    notes: contact.notes || null,
    event_title: eventTitle || null,
    luma_event_url: lumaEventUrl || null,
    date_met: eventDate || null,
  });

  await clearState(telegramUserId);

  if (error) {
    console.error('Error inserting contact:', error);
    await sendMessage(chatId, '❌ Failed to save contact. Please try again.');
    return;
  }

  const displayName = contact.lastName
    ? `${contact.firstName} ${contact.lastName}`
    : contact.firstName;
  const company = contact.projectCompany ? ` (${contact.projectCompany})` : '';

  await sendMessage(
    chatId,
    `✅ Contact saved!\n\n` +
      `<b>${displayName}</b>${company}\n` +
      (eventTitle ? `→ ${eventTitle}\n\n` : '\n') +
      'Use /newcontact to add another contact.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
        ],
      },
    }
  );
}

// ============================================================
// ITINERARY CREATION FLOW (/newitinerary)
// ============================================================

async function handleNewItinerary(chatId: number, telegramUserId: number) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(
      chatId,
      '❌ Your account is not linked yet.\n\n' +
        'Go to your web app → Contacts → Link Telegram to get started.'
    );
    return;
  }

  // Check itinerary limit (10)
  const { count } = await supabase
    .from('itineraries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (count !== null && count >= 10) {
    await sendMessage(
      chatId,
      '❌ You\'ve reached the maximum of 10 itineraries.\n\nDelete an existing one in the web app to create a new one.'
    );
    return;
  }

  await setState(telegramUserId, 'new_it_title', { itinerary: {} });
  await sendMessage(
    chatId,
    '🗺 <b>Create a new itinerary</b>\n\n' +
      'Enter the <b>trip title</b>:\n' +
      '<i>e.g. Hong Kong Consensus 2025</i>'
  );
}

async function handleItineraryTextInput(
  chatId: number,
  telegramUserId: number,
  text: string,
  currentState: BotState
) {
  const state = currentState.state;
  const itData = { ...(currentState.data.itinerary as Record<string, string> || {}) };
  const baseData = { ...currentState.data, itinerary: itData };

  if (state === 'new_it_title') {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      await sendMessage(chatId, '❌ Title must be between 1 and 200 characters.');
      return;
    }
    itData.title = trimmed;
    if (currentState.data._editMode) {
      delete baseData._editMode;
      await showItineraryConfirmation(chatId, telegramUserId, baseData);
      return;
    }
    await setState(telegramUserId, 'new_it_location', baseData);
    await sendMessage(
      chatId,
      'Enter the <b>location</b>:\n<i>e.g. Hong Kong</i>'
    );
  } else if (state === 'new_it_location') {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 500) {
      await sendMessage(chatId, '❌ Location must be between 1 and 500 characters.');
      return;
    }
    itData.location = trimmed;
    if (currentState.data._editMode) {
      delete baseData._editMode;
      await showItineraryConfirmation(chatId, telegramUserId, baseData);
      return;
    }
    await setState(telegramUserId, 'new_it_start', baseData);
    await sendMessage(
      chatId,
      'Enter the <b>start date</b> (YYYY-MM-DD):\n<i>e.g. 2025-03-15</i>'
    );
  } else if (state === 'new_it_start') {
    if (!isValidDate(text)) {
      await sendMessage(chatId, '❌ Invalid date. Please use YYYY-MM-DD format (e.g. 2025-03-15).');
      return;
    }
    itData.startDate = text.trim();
    if (currentState.data._editMode) {
      // Validate against end date if it exists
      if (itData.endDate && itData.startDate > itData.endDate) {
        await sendMessage(chatId, '❌ Start date must be on or before the end date.');
        return;
      }
      delete baseData._editMode;
      await showItineraryConfirmation(chatId, telegramUserId, baseData);
      return;
    }
    await setState(telegramUserId, 'new_it_end', baseData);
    await sendMessage(
      chatId,
      'Enter the <b>end date</b> (YYYY-MM-DD):\n<i>e.g. 2025-03-20</i>'
    );
  } else if (state === 'new_it_end') {
    if (!isValidDate(text)) {
      await sendMessage(chatId, '❌ Invalid date. Please use YYYY-MM-DD format (e.g. 2025-03-20).');
      return;
    }
    const endDate = text.trim();
    if (endDate < itData.startDate) {
      await sendMessage(chatId, '❌ End date must be on or after the start date.');
      return;
    }
    // Check max 365 days
    const start = new Date(itData.startDate);
    const end = new Date(endDate);
    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 365) {
      await sendMessage(chatId, '❌ Trip duration cannot exceed 365 days.');
      return;
    }
    itData.endDate = endDate;
    if (currentState.data._editMode) {
      delete baseData._editMode;
    }
    await showItineraryConfirmation(chatId, telegramUserId, baseData);
  }
}

async function showItineraryConfirmation(
  chatId: number,
  telegramUserId: number,
  stateData: Record<string, unknown>
) {
  const it = stateData.itinerary as Record<string, string>;

  const startDate = new Date(it.startDate);
  const endDate = new Date(it.endDate);
  const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const fmtStart = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtEnd = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  let summary = '<b>📋 Confirm new itinerary:</b>\n\n';
  summary += `🏷 Title: ${it.title}\n`;
  summary += `📍 Location: ${it.location}\n`;
  summary += `📅 Dates: ${fmtStart} — ${fmtEnd} (${diffDays} day${diffDays !== 1 ? 's' : ''})\n`;

  await setState(telegramUserId, 'new_it_confirm', stateData);

  await sendMessage(chatId, summary, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Confirm', callback_data: 'yc:yes' },
          { text: '❌ Cancel', callback_data: 'yc:no' },
        ],
        [
          { text: '✏️ Title', callback_data: 'ye:0' },
          { text: '✏️ Location', callback_data: 'ye:1' },
        ],
        [
          { text: '✏️ Start Date', callback_data: 'ye:2' },
          { text: '✏️ End Date', callback_data: 'ye:3' },
        ],
      ],
    },
  });
}

async function handleItineraryConfirmation(
  chatId: number,
  telegramUserId: number,
  confirmed: boolean,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  if (!confirmed) {
    await clearState(telegramUserId);
    await sendMessage(chatId, '❌ Cancelled. Use /help for commands.');
    return;
  }

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  const currentState = await getState(telegramUserId);
  const it = currentState.data.itinerary as Record<string, string>;

  // Generate days array
  const days: Array<{
    date: string;
    dayNumber: number;
    events: never[];
    checklist: never[];
    goals: never[];
  }> = [];
  const current = new Date(it.startDate);
  const end = new Date(it.endDate);
  let dayNumber = 1;
  while (current <= end) {
    days.push({
      date: current.toISOString().split('T')[0],
      dayNumber,
      events: [],
      checklist: [],
      goals: [],
    });
    current.setDate(current.getDate() + 1);
    dayNumber++;
  }

  // Insert into Supabase
  const { error } = await supabase.from('itineraries').insert({
    user_id: userId,
    title: it.title,
    start_date: it.startDate,
    end_date: it.endDate,
    location: it.location,
    data: { days, transitSegments: [] },
  });

  await clearState(telegramUserId);

  if (error) {
    console.error('Error inserting itinerary:', error);
    await sendMessage(chatId, '❌ Failed to save itinerary. Please try again.');
    return;
  }

  const diffDays = days.length;
  await sendMessage(
    chatId,
    `✅ Itinerary created!\n\n` +
      `<b>${it.title}</b>\n` +
      `📍 ${it.location}\n` +
      `📅 ${diffDays} day${diffDays !== 1 ? 's' : ''}\n\n` +
      'Use /newevent to add events, or /newcontact to add contacts.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
        ],
      },
    }
  );
}

const ITINERARY_EDIT_FIELDS = [
  { state: 'new_it_title', label: 'title', prompt: '✏️ Enter the new <b>trip title</b>:' },
  { state: 'new_it_location', label: 'location', prompt: '✏️ Enter the new <b>location</b>:' },
  { state: 'new_it_start', label: 'start date', prompt: '✏️ Enter the new <b>start date</b> (YYYY-MM-DD):' },
  { state: 'new_it_end', label: 'end date', prompt: '✏️ Enter the new <b>end date</b> (YYYY-MM-DD):' },
];

async function handleItineraryEdit(
  chatId: number,
  telegramUserId: number,
  fieldIndex: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  if (fieldIndex < 0 || fieldIndex >= ITINERARY_EDIT_FIELDS.length) return;

  const currentState = await getState(telegramUserId);
  const field = ITINERARY_EDIT_FIELDS[fieldIndex];

  await setState(telegramUserId, field.state, {
    ...currentState.data,
    _editMode: true,
  });

  await sendMessage(chatId, field.prompt);
}

// ============================================================
// EVENT CREATION FLOW (/newevent)
// ============================================================

async function handleNewEvent(chatId: number, telegramUserId: number) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(
      chatId,
      '❌ Your account is not linked yet.\n\n' +
        'Go to your web app → Contacts → Link Telegram to get started.'
    );
    return;
  }

  // Fetch user's itineraries
  const { data: itineraries } = await supabase
    .from('itineraries')
    .select('id, title, start_date, end_date, location')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
    .limit(10);

  if (!itineraries || itineraries.length === 0) {
    await sendMessage(
      chatId,
      '❌ No itineraries found. Create one first with /newitinerary.'
    );
    return;
  }

  // Build inline keyboard with itineraries
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const it of itineraries) {
    keyboard.push([{
      text: `${it.title} (${it.location})`,
      callback_data: `xi:${it.id}`,
    }]);
  }

  await setState(telegramUserId, 'new_ev_select_it', {});
  await sendMessage(chatId, '📅 <b>Add a new event</b>\n\nSelect an itinerary:', {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleNewEventItSelection(
  chatId: number,
  telegramUserId: number,
  itineraryId: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  // Fetch the itinerary to get days
  const { data: itinerary } = await supabase
    .from('itineraries')
    .select('id, title, data')
    .eq('id', itineraryId)
    .eq('user_id', userId)
    .single();

  if (!itinerary) {
    await sendMessage(chatId, '❌ Itinerary not found.');
    await clearState(telegramUserId);
    return;
  }

  const itineraryData = itinerary.data as { days?: Array<{ date: string; events?: unknown[] }> };
  const days = itineraryData?.days || [];

  if (days.length === 0) {
    await sendMessage(chatId, '❌ This itinerary has no days. Please fix it in the web app.');
    await clearState(telegramUserId);
    return;
  }

  // Check event limit (20 per itinerary)
  let totalEvents = 0;
  for (const day of days) {
    totalEvents += (day.events as unknown[] || []).length;
  }
  if (totalEvents >= 20) {
    await sendMessage(
      chatId,
      '❌ This itinerary already has 20 events (maximum). Delete some in the web app first.'
    );
    await clearState(telegramUserId);
    return;
  }

  // Build day selection keyboard — "Import via Luma Link" at the top
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: '🔗 Import via Luma Link', callback_data: 'xl:import' }],
  ];
  for (const day of days.slice(0, 30)) {
    const d = new Date(day.date);
    const label = d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const evCount = (day.events as unknown[] || []).length;
    const evLabel = evCount > 0 ? ` (${evCount} event${evCount !== 1 ? 's' : ''})` : '';
    keyboard.push([{
      text: `${label}${evLabel}`,
      callback_data: `xd:${day.date}`,
    }]);
  }

  // Store itinerary date range for Luma import validation
  const itStartDate = days[0]?.date;
  const itEndDate = days[days.length - 1]?.date;

  await setState(telegramUserId, 'new_ev_select_day', {
    itineraryId: itinerary.id,
    itineraryTitle: itinerary.title,
    itStartDate,
    itEndDate,
  });

  await sendMessage(
    chatId,
    `📅 Select a day from <b>${itinerary.title}</b>:`,
    { reply_markup: { inline_keyboard: keyboard } }
  );
}

async function handleLumaImportSelect(
  chatId: number,
  telegramUserId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const currentState = await getState(telegramUserId);

  await setState(telegramUserId, 'new_ev_luma_input', {
    ...currentState.data,
  });

  await sendMessage(
    chatId,
    '🔗 <b>Import via Luma Link</b>\n\n' +
      'Paste one or more Luma event links.\n' +
      'I\'ll automatically detect the date and add each event to the right day.\n\n' +
      '<i>e.g. https://lu.ma/abc123</i>\n\n' +
      'You can paste multiple links in a single message.',
    {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'xc:no' }]],
      },
    }
  );
}

async function handleLumaInput(
  chatId: number,
  telegramUserId: number,
  text: string,
  currentState: BotState
) {
  const urls = extractLumaUrls(text);

  if (urls.length === 0) {
    await sendMessage(
      chatId,
      '❌ No Luma links found. Please paste a valid lu.ma or luma.com URL.\n\n' +
        '<i>e.g. https://lu.ma/abc123</i>'
    );
    return;
  }

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  const itineraryId = currentState.data.itineraryId as string;
  const itineraryTitle = currentState.data.itineraryTitle as string;
  const itStartDate = currentState.data.itStartDate as string;
  const itEndDate = currentState.data.itEndDate as string;

  await sendMessage(chatId, `🔄 Fetching ${urls.length} Luma event${urls.length > 1 ? 's' : ''}...`);

  // Fetch current itinerary data
  const { data: itinerary } = await supabase
    .from('itineraries')
    .select('data')
    .eq('id', itineraryId)
    .eq('user_id', userId)
    .single();

  if (!itinerary) {
    await clearState(telegramUserId);
    await sendMessage(chatId, '❌ Itinerary not found. It may have been deleted.');
    return;
  }

  const itData = itinerary.data as {
    days: Array<{
      date: string;
      dayNumber: number;
      events: Array<Record<string, unknown>>;
      checklist: unknown[];
      goals: unknown[];
    }>;
    transitSegments: unknown[];
  };

  // Count current events for limit check
  let totalEvents = 0;
  for (const day of itData.days) {
    totalEvents += day.events.length;
  }

  const results: string[] = [];
  let addedCount = 0;

  for (const url of urls) {
    // Check event limit
    if (totalEvents + addedCount >= 20) {
      results.push(`⏭ <b>Skipped</b> — event limit reached (20 max)`);
      break;
    }

    const eventData = await fetchLumaEvent(url);
    if (!eventData) {
      results.push(`❌ Could not fetch event from:\n${url}`);
      continue;
    }

    if (!eventData.startTime) {
      results.push(`❌ <b>${eventData.title}</b> — no date/time found`);
      continue;
    }

    // Parse the event's date
    const eventStart = new Date(eventData.startTime);
    if (isNaN(eventStart.getTime())) {
      results.push(`❌ <b>${eventData.title}</b> — invalid date`);
      continue;
    }

    const eventDateStr = eventStart.toISOString().split('T')[0];

    // Check if event falls within itinerary date range
    if (eventDateStr < itStartDate || eventDateStr > itEndDate) {
      const fmtDate = eventStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      results.push(
        `⏭ <b>${eventData.title}</b> — ${fmtDate} is outside the trip dates (${itStartDate} to ${itEndDate})`
      );
      continue;
    }

    // Check for duplicate — match by lumaEventUrl or same title on the same date
    const isDuplicate = itData.days.some((day) =>
      day.events.some((existing) =>
        (existing.lumaEventUrl && existing.lumaEventUrl === url) ||
        (day.date === eventDateStr && existing.title === eventData.title)
      )
    );
    if (isDuplicate) {
      results.push(`⏭ <b>${eventData.title}</b> — already in this itinerary`);
      continue;
    }

    // Find the matching day
    const dayIndex = itData.days.findIndex((d) => d.date === eventDateStr);
    if (dayIndex === -1) {
      results.push(`⏭ <b>${eventData.title}</b> — no matching day found`);
      continue;
    }

    // Build the event object
    const eventEnd = eventData.endTime ? new Date(eventData.endTime) : null;
    const startTimeStr = `${eventStart.getUTCHours().toString().padStart(2, '0')}:${eventStart.getUTCMinutes().toString().padStart(2, '0')}`;
    const endTimeStr = eventEnd
      ? `${eventEnd.getUTCHours().toString().padStart(2, '0')}:${eventEnd.getUTCMinutes().toString().padStart(2, '0')}`
      : startTimeStr;

    const newEvent = {
      id: crypto.randomUUID(),
      title: eventData.title,
      startTime: `${eventDateStr}T${startTimeStr}:00`,
      endTime: `${eventDateStr}T${endTimeStr}:00`,
      location: {
        name: eventData.location?.name || '',
        address: eventData.location?.address || '',
      },
      eventType: 'side-event',
      lumaEventUrl: url,
      notes: [],
      checklist: [],
    };

    // Add and sort
    itData.days[dayIndex].events.push(newEvent);
    itData.days[dayIndex].events.sort((a, b) => {
      const aTime = (a.startTime as string) || '';
      const bTime = (b.startTime as string) || '';
      return aTime.localeCompare(bTime);
    });

    addedCount++;

    const fmtDate = eventStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    results.push(`✅ <b>${eventData.title}</b> — added to ${fmtDate} (${startTimeStr}–${endTimeStr})`);
  }

  // Save if any events were added
  if (addedCount > 0) {
    const { error } = await supabase
      .from('itineraries')
      .update({ data: itData })
      .eq('id', itineraryId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error saving Luma events:', error);
      await clearState(telegramUserId);
      await sendMessage(chatId, '❌ Failed to save events. Please try again.');
      return;
    }
  }

  let summary = `<b>🔗 Luma Import — ${itineraryTitle}</b>\n\n`;
  summary += results.join('\n\n');
  summary += `\n\n${addedCount > 0 ? `${addedCount} event${addedCount !== 1 ? 's' : ''} added.` : 'No events were added.'}`;
  summary += '\n\nPaste more Luma links to continue importing, or use /cancel to stop.';

  // Stay in luma input state so user can keep pasting links
  await setState(telegramUserId, 'new_ev_luma_input', {
    itineraryId,
    itineraryTitle,
    itStartDate,
    itEndDate,
  });

  await sendMessage(chatId, summary, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
      ],
    },
  });
}

async function handleNewEventDaySelection(
  chatId: number,
  telegramUserId: number,
  date: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const currentState = await getState(telegramUserId);
  const fmtDate = new Date(date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  await setState(telegramUserId, 'new_ev_title', {
    ...currentState.data,
    eventDate: date,
    event: {},
  });

  await sendMessage(
    chatId,
    `📅 Adding event for <b>${fmtDate}</b>\n\n` +
      'Enter the <b>event title</b>:\n' +
      '<i>e.g. Team Dinner at Sake Bar</i>'
  );
}

async function handleNewEventTypeSelection(
  chatId: number,
  telegramUserId: number,
  eventType: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const validTypes = EVENT_TYPE_OPTIONS.map((o) => o.value);
  if (!validTypes.includes(eventType)) {
    await sendMessage(chatId, '❌ Invalid event type.');
    return;
  }

  const currentState = await getState(telegramUserId);
  const eventData = { ...(currentState.data.event as Record<string, string> || {}) };
  eventData.eventType = eventType;
  const updatedData = { ...currentState.data, event: eventData };

  // If editing from confirmation, return to confirmation
  if (currentState.data._editMode) {
    delete updatedData._editMode;
    await showEventConfirmation(chatId, telegramUserId, updatedData);
    return;
  }

  await setState(telegramUserId, 'new_ev_start_time', updatedData);
  await sendMessage(
    chatId,
    'Enter the <b>start time</b> (HH:MM):\n<i>e.g. 09:00</i>'
  );
}

async function handleEventTextInput(
  chatId: number,
  telegramUserId: number,
  text: string,
  currentState: BotState
) {
  const state = currentState.state;

  // Handle Luma link input separately
  if (state === 'new_ev_luma_input') {
    await handleLumaInput(chatId, telegramUserId, text, currentState);
    return;
  }

  const eventData = { ...(currentState.data.event as Record<string, string> || {}) };
  const baseData = { ...currentState.data, event: eventData };

  if (state === 'new_ev_title') {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      await sendMessage(chatId, '❌ Title must be between 1 and 200 characters.');
      return;
    }
    eventData.title = trimmed;
    if (currentState.data._editMode) {
      delete baseData._editMode;
      await showEventConfirmation(chatId, telegramUserId, baseData);
      return;
    }
    // Show event type keyboard
    await setState(telegramUserId, 'new_ev_type', baseData);
    await sendMessage(chatId, 'Select the <b>event type</b>:', {
      reply_markup: { inline_keyboard: EVENT_TYPE_KEYBOARD },
    });
  } else if (state === 'new_ev_start_time') {
    if (!isValidTime(text)) {
      await sendMessage(chatId, '❌ Invalid time. Please use HH:MM format (e.g. 09:00).');
      return;
    }
    eventData.startTime = padTime(text);
    if (currentState.data._editMode) {
      delete baseData._editMode;
      await showEventConfirmation(chatId, telegramUserId, baseData);
      return;
    }
    await setState(telegramUserId, 'new_ev_end_time', baseData);
    await sendMessage(
      chatId,
      'Enter the <b>end time</b> (HH:MM):\n<i>e.g. 17:00</i>'
    );
  } else if (state === 'new_ev_end_time') {
    if (!isValidTime(text)) {
      await sendMessage(chatId, '❌ Invalid time. Please use HH:MM format (e.g. 17:00).');
      return;
    }
    eventData.endTime = padTime(text);
    if (currentState.data._editMode) {
      delete baseData._editMode;
      await showEventConfirmation(chatId, telegramUserId, baseData);
      return;
    }
    await setState(telegramUserId, 'new_ev_location', baseData);
    await sendMessage(
      chatId,
      'Enter the <b>location name</b> (optional):\n<i>e.g. Convention Center</i>',
      {
        reply_markup: {
          inline_keyboard: [[{ text: '⏭ Skip', callback_data: 'skip' }]],
        },
      }
    );
  } else if (state === 'new_ev_location') {
    const trimmed = text.trim();
    if (trimmed.length > 200) {
      await sendMessage(chatId, '❌ Location name must be 200 characters or fewer.');
      return;
    }
    eventData.locationName = trimmed;
    if (currentState.data._editMode) {
      delete baseData._editMode;
    }
    await showEventConfirmation(chatId, telegramUserId, baseData);
  }
}

async function showEventConfirmation(
  chatId: number,
  telegramUserId: number,
  stateData: Record<string, unknown>
) {
  const ev = stateData.event as Record<string, string>;
  const itTitle = stateData.itineraryTitle as string;
  const evDate = stateData.eventDate as string;

  const fmtDate = new Date(evDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  let summary = '<b>📋 Confirm new event:</b>\n\n';
  summary += `📅 ${itTitle} → ${fmtDate}\n\n`;
  summary += `🏷 Title: ${ev.title}\n`;
  summary += `🎯 Type: ${getEventTypeLabel(ev.eventType)}\n`;
  summary += `🕐 Time: ${ev.startTime} — ${ev.endTime}\n`;
  if (ev.locationName) {
    summary += `📍 Location: ${ev.locationName}\n`;
  }

  await setState(telegramUserId, 'new_ev_confirm', stateData);

  await sendMessage(chatId, summary, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Confirm', callback_data: 'xc:yes' },
          { text: '❌ Cancel', callback_data: 'xc:no' },
        ],
        [
          { text: '✏️ Title', callback_data: 'xe:0' },
          { text: '✏️ Type', callback_data: 'xe:1' },
        ],
        [
          { text: '✏️ Start Time', callback_data: 'xe:2' },
          { text: '✏️ End Time', callback_data: 'xe:3' },
          { text: '✏️ Location', callback_data: 'xe:4' },
        ],
      ],
    },
  });
}

async function handleEventConfirmation(
  chatId: number,
  telegramUserId: number,
  confirmed: boolean,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  if (!confirmed) {
    await clearState(telegramUserId);
    await sendMessage(chatId, '❌ Cancelled. Use /help for commands.');
    return;
  }

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  const currentState = await getState(telegramUserId);
  const ev = currentState.data.event as Record<string, string>;
  const itineraryId = currentState.data.itineraryId as string;
  const eventDate = currentState.data.eventDate as string;

  // Fetch current itinerary data
  const { data: itinerary } = await supabase
    .from('itineraries')
    .select('data')
    .eq('id', itineraryId)
    .eq('user_id', userId)
    .single();

  if (!itinerary) {
    await clearState(telegramUserId);
    await sendMessage(chatId, '❌ Itinerary not found. It may have been deleted.');
    return;
  }

  const itData = itinerary.data as {
    days: Array<{
      date: string;
      dayNumber: number;
      events: Array<Record<string, unknown>>;
      checklist: unknown[];
      goals: unknown[];
    }>;
    transitSegments: unknown[];
  };

  // Find the target day
  const dayIndex = itData.days.findIndex((d) => d.date === eventDate);
  if (dayIndex === -1) {
    await clearState(telegramUserId);
    await sendMessage(chatId, '❌ Day not found in itinerary. It may have been modified.');
    return;
  }

  // Build the new event object
  const eventId = crypto.randomUUID();
  const newEvent = {
    id: eventId,
    title: ev.title,
    startTime: `${eventDate}T${ev.startTime}:00`,
    endTime: `${eventDate}T${ev.endTime}:00`,
    location: {
      name: ev.locationName || '',
      address: '',
    },
    eventType: ev.eventType,
    notes: [],
    checklist: [],
  };

  // Add to the day's events and sort by startTime
  itData.days[dayIndex].events.push(newEvent);
  itData.days[dayIndex].events.sort((a, b) => {
    const aTime = (a.startTime as string) || '';
    const bTime = (b.startTime as string) || '';
    return aTime.localeCompare(bTime);
  });

  // Update the itinerary data in Supabase
  const { error } = await supabase
    .from('itineraries')
    .update({ data: itData })
    .eq('id', itineraryId)
    .eq('user_id', userId);

  await clearState(telegramUserId);

  if (error) {
    console.error('Error updating itinerary with new event:', error);
    await sendMessage(chatId, '❌ Failed to save event. Please try again.');
    return;
  }

  const fmtDate = new Date(eventDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  await sendMessage(
    chatId,
    `✅ Event added!\n\n` +
      `<b>${ev.title}</b>\n` +
      `${getEventTypeLabel(ev.eventType)} · ${ev.startTime} — ${ev.endTime}\n` +
      `📅 ${fmtDate}\n` +
      (ev.locationName ? `📍 ${ev.locationName}\n` : '') +
      '\nUse /newevent to add another event, or /newcontact to add a contact.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
        ],
      },
    }
  );
}

const EVENT_EDIT_FIELDS = [
  { state: 'new_ev_title', prompt: '✏️ Enter the new <b>event title</b>:' },
  { state: 'new_ev_type', prompt: '' }, // type uses keyboard, not text
  { state: 'new_ev_start_time', prompt: '✏️ Enter the new <b>start time</b> (HH:MM):' },
  { state: 'new_ev_end_time', prompt: '✏️ Enter the new <b>end time</b> (HH:MM):' },
  { state: 'new_ev_location', prompt: '✏️ Enter the new <b>location name</b>:' },
];

async function handleEventEdit(
  chatId: number,
  telegramUserId: number,
  fieldIndex: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  if (fieldIndex < 0 || fieldIndex >= EVENT_EDIT_FIELDS.length) return;

  const currentState = await getState(telegramUserId);
  const field = EVENT_EDIT_FIELDS[fieldIndex];

  // Special handling for event type — show keyboard instead of text input
  if (fieldIndex === 1) {
    await setState(telegramUserId, 'new_ev_type', {
      ...currentState.data,
      _editMode: true,
    });
    await sendMessage(chatId, '✏️ Select the new <b>event type</b>:', {
      reply_markup: { inline_keyboard: EVENT_TYPE_KEYBOARD },
    });
    return;
  }

  await setState(telegramUserId, field.state, {
    ...currentState.data,
    _editMode: true,
  });

  await sendMessage(chatId, field.prompt);
}

// ============================================================
// MAIN TEXT INPUT ROUTER
// ============================================================

async function handleTextInput(
  chatId: number,
  telegramUserId: number,
  text: string
) {
  const currentState = await getState(telegramUserId);

  // Route to itinerary creation flow
  if (currentState.state.startsWith('new_it_')) {
    await handleItineraryTextInput(chatId, telegramUserId, text, currentState);
    return;
  }

  // Route to event creation flow
  if (currentState.state.startsWith('new_ev_')) {
    await handleEventTextInput(chatId, telegramUserId, text, currentState);
    return;
  }

  // Contact creation flow
  const handled = await handleContactTextInput(chatId, telegramUserId, text, currentState);
  if (handled) return;

  // No matching state
  await sendMessage(
    chatId,
    'Use /newcontact to add a contact, /newitinerary to create a trip, /newevent to add an event, or /help for commands.'
  );
}

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook secret
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
  if (secretHeader !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const update = req.body;

    if (update.message) {
      const msg = update.message;
      const chatId: number = msg.chat.id;
      const telegramUserId: number = msg.from.id;
      const telegramUsername: string | undefined = msg.from.username;
      const text: string = msg.text || '';

      if (text.startsWith('/start')) {
        const args = text.substring('/start'.length).trim();
        await handleStart(chatId, telegramUserId, telegramUsername, args);
      } else if (text === '/newcontact') {
        await handleNewContact(chatId, telegramUserId);
      } else if (text === '/newitinerary') {
        await handleNewItinerary(chatId, telegramUserId);
      } else if (text === '/newevent') {
        await handleNewEvent(chatId, telegramUserId);
      } else if (text === '/cancel') {
        await clearState(telegramUserId);
        await sendMessage(chatId, '❌ Cancelled. Use /help for commands.');
      } else if (text === '/help') {
        await sendMessage(
          chatId,
          '<b>Available commands:</b>\n\n' +
            '/newitinerary — Create a new trip\n' +
            '/newevent — Add an event to a trip\n' +
            '/newcontact — Add a new contact\n' +
            '/cancel — Cancel current operation\n' +
            '/help — Show this help message',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
              ],
            },
          }
        );
      } else {
        // Regular text — handle based on conversation state
        await handleTextInput(chatId, telegramUserId, text);
      }
    } else if (update.callback_query) {
      const cq = update.callback_query;
      const chatId: number = cq.message.chat.id;
      const telegramUserId: number = cq.from.id;
      const data: string = cq.data;

      // --- Contact flow callbacks ---
      if (data.startsWith('it:')) {
        await handleItinerarySelection(chatId, telegramUserId, data.substring(3), cq.id);
      } else if (data.startsWith('ev:')) {
        await handleEventSelection(chatId, telegramUserId, data.substring(3), cq.id);
      } else if (data === 'skip') {
        await handleSkip(chatId, telegramUserId, cq.id);
      } else if (data.startsWith('cf:')) {
        await handleContactConfirmation(chatId, telegramUserId, data === 'cf:yes', cq.id);
      } else if (data.startsWith('ed:')) {
        const fieldIndex = parseInt(data.substring(3), 10);
        await handleContactEdit(chatId, telegramUserId, fieldIndex, cq.id);
      }
      // --- Itinerary creation callbacks ---
      else if (data.startsWith('yc:')) {
        await handleItineraryConfirmation(chatId, telegramUserId, data === 'yc:yes', cq.id);
      } else if (data.startsWith('ye:')) {
        const fieldIndex = parseInt(data.substring(3), 10);
        await handleItineraryEdit(chatId, telegramUserId, fieldIndex, cq.id);
      }
      // --- Event creation callbacks ---
      else if (data.startsWith('xi:')) {
        await handleNewEventItSelection(chatId, telegramUserId, data.substring(3), cq.id);
      } else if (data.startsWith('xl:')) {
        await handleLumaImportSelect(chatId, telegramUserId, cq.id);
      } else if (data.startsWith('xd:')) {
        await handleNewEventDaySelection(chatId, telegramUserId, data.substring(3), cq.id);
      } else if (data.startsWith('xt:')) {
        await handleNewEventTypeSelection(chatId, telegramUserId, data.substring(3), cq.id);
      } else if (data.startsWith('xc:')) {
        await handleEventConfirmation(chatId, telegramUserId, data === 'xc:yes', cq.id);
      } else if (data.startsWith('xe:')) {
        const fieldIndex = parseInt(data.substring(3), 10);
        await handleEventEdit(chatId, telegramUserId, fieldIndex, cq.id);
      }
    }

    // Always return 200 to Telegram (prevents retries)
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    // Still return 200 to prevent Telegram from retrying
    return res.status(200).json({ ok: true });
  }
}
