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
        '👋 <b>Welcome back!</b> Your account is linked.\n\n' +
          '📋 <b>Plan your trip</b>\n' +
          '/newitinerary — Create a new trip\n' +
          '/newevent — Add events (or paste Luma links)\n' +
          '/itineraries — View trips & events\n' +
          '/today — Today\'s events at a glance\n\n' +
          '👥 <b>Manage contacts</b>\n' +
          '/newcontact — Add a contact\n' +
          '/contacts — Browse contacts by trip or event\n' +
          '/contacted @handle — Log a follow-up\n\n' +
          '💡 <b>Quick actions</b>\n' +
          '• <b>Forward a message</b> → adds a note if the contact exists, or creates a new contact\n' +
          '• Tag and annotate contacts in the web app\n\n' +
          'Use /help for the full command list.',
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
        '👋 <b>Welcome to Shareable Itinerary!</b>\n\n' +
          'Your all-in-one trip planner and networking companion.\n\n' +
          '✈️ Create and manage trip itineraries\n' +
          '📅 Import events from Luma links\n' +
          '👥 Track contacts you meet at events\n' +
          '🏷 Tag and add notes to contacts\n' +
          '💬 Follow up via Telegram DMs\n' +
          '📨 Bulk-invite contacts from the web app\n\n' +
          'Tap <b>Open App</b> to get started, or link an existing account from the web app → Contacts → Link Telegram.',
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
    '✅ <b>Account linked successfully!</b>\n\n' +
      'You\'re all set. Here\'s what you can do:\n\n' +
      '📋 <b>Trip Planning</b>\n' +
      '/newitinerary — Create a trip\n' +
      '/newevent — Add events (or paste Luma links)\n' +
      '/itineraries — View trips & events\n' +
      '/today — Today\'s events at a glance\n\n' +
      '👥 <b>Contacts</b>\n' +
      '/newcontact — Add a contact\n' +
      '/contacts — Browse contacts by trip or event\n' +
      '/contacted @handle — Log a follow-up\n\n' +
      '💡 <b>Forward a message</b> from someone → saves them as a contact, or adds a note if they already exist!\n\n' +
      'Use /help for the full command list.'
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

  // Check if we're in forward mode (contact info already populated)
  const currentState = await getState(telegramUserId);
  const isForwardMode = !!currentState.data?._forwardMode;

  // Skip itinerary/event — go straight to contact fields (or confirmation in forward mode)
  if (itineraryId === 'skip') {
    if (isForwardMode) {
      const data = { ...currentState.data };
      delete data.itineraryId;
      delete data.eventId;
      delete data.eventTitle;
      delete data.eventDate;
      await showContactConfirmation(chatId, telegramUserId, data);
    } else {
      await setState(telegramUserId, 'input_telegram_handle', {
        contact: {},
      });
      await sendMessage(
        chatId,
        '📝 Adding standalone contact\n\n' +
          'Enter their <b>Telegram handle</b> (required):\n' +
          '<i>e.g. @johndoe</i>'
      );
    }
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

  const eventStateData: Record<string, unknown> = {
    itineraryId: itinerary.id,
    itineraryTitle: itinerary.title,
    events: events.map((e) => ({ id: e.id, title: e.title, date: e.date })),
  };
  // Preserve forward mode data (contact info) through the selection flow
  if (isForwardMode) {
    eventStateData._forwardMode = true;
    eventStateData.contact = currentState.data.contact;
  }
  await setState(telegramUserId, 'select_event', eventStateData);

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

  const isForwardMode = !!currentState.data?._forwardMode;

  // Skip event — keep itinerary info but no event
  if (eventId === 'skip') {
    if (isForwardMode) {
      const data = { ...currentState.data };
      delete data.eventId;
      delete data.eventTitle;
      delete data.eventDate;
      await showContactConfirmation(chatId, telegramUserId, data);
    } else {
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
    }
    return;
  }

  const events = (currentState.data.events as EventInfo[]) || [];
  const selectedEvent = events.find((e) => e.id === eventId);

  if (!selectedEvent) {
    await sendMessage(chatId, '❌ Event not found.');
    await clearState(telegramUserId);
    return;
  }

  if (isForwardMode) {
    // In forward mode, skip input fields and go straight to confirmation
    const data = {
      ...currentState.data,
      eventId: selectedEvent.id,
      eventTitle: selectedEvent.title,
      eventDate: selectedEvent.date,
    };
    await showContactConfirmation(chatId, telegramUserId, data);
  } else {
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
  const selectedTags = (stateData._selectedTags as string[] | undefined) || [];

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
  if (selectedTags.length > 0) summary += `🏷 Labels: ${selectedTags.join(', ')}\n`;

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
        [
          { text: `🏷 Labels${selectedTags.length > 0 ? ` (${selectedTags.length})` : ''}`, callback_data: 'tg:show' },
        ],
      ],
    },
  });
}

async function handleTagSelection(
  chatId: number,
  telegramUserId: number,
  action: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const currentState = await getState(telegramUserId);
  if (currentState.state !== 'confirm' && currentState.state !== 'select_tags') {
    await sendMessage(chatId, '❌ Session expired. Please start over.');
    return;
  }

  const selectedTags = (currentState.data._selectedTags as string[] | undefined) || [];

  if (action === 'show') {
    // Fetch user's tags and show toggle keyboard
    const userId = await getLinkedUserId(telegramUserId);
    if (!userId) return;

    const { data: userTags } = await supabase
      .from('user_tags')
      .select('name')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (!userTags || userTags.length === 0) {
      await sendMessage(chatId, '🏷 No labels created yet. Create labels in the web app first, then assign them here.');
      return;
    }

    await setState(telegramUserId, 'select_tags', currentState.data);

    const keyboard = userTags.map((t) => {
      const name = t.name as string;
      const selected = selectedTags.includes(name);
      return [{ text: `${selected ? '✅' : '⬜️'} ${name}`, callback_data: `tg:t:${name.substring(0, 55)}` }];
    });
    keyboard.push([{ text: '✅ Done', callback_data: 'tg:done' }]);

    await sendMessage(chatId,
      `🏷 <b>Select labels</b> (up to 3):\n\nCurrently selected: ${selectedTags.length > 0 ? selectedTags.join(', ') : 'none'}`,
      { reply_markup: { inline_keyboard: keyboard } }
    );
    return;
  }

  if (action === 'done') {
    // Return to confirmation screen
    await showContactConfirmation(chatId, telegramUserId, currentState.data);
    return;
  }

  if (action.startsWith('t:')) {
    // Toggle a tag
    const tagName = action.substring(2);
    let newTags: string[];

    if (selectedTags.includes(tagName)) {
      newTags = selectedTags.filter((t) => t !== tagName);
    } else if (selectedTags.length >= 3) {
      await sendMessage(chatId, '⚠️ Maximum 3 labels per contact. Remove one first.');
      return;
    } else {
      newTags = [...selectedTags, tagName];
    }

    const updatedData = { ...currentState.data, _selectedTags: newTags };
    await setState(telegramUserId, 'select_tags', updatedData);

    // Fetch user's tags to rebuild the keyboard
    const userId = await getLinkedUserId(telegramUserId);
    if (!userId) return;

    const { data: userTags } = await supabase
      .from('user_tags')
      .select('name')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (!userTags) return;

    const keyboard = userTags.map((t) => {
      const name = t.name as string;
      const selected = newTags.includes(name);
      return [{ text: `${selected ? '✅' : '⬜️'} ${name}`, callback_data: `tg:t:${name.substring(0, 55)}` }];
    });
    keyboard.push([{ text: '✅ Done', callback_data: 'tg:done' }]);

    await sendMessage(chatId,
      `🏷 <b>Select labels</b> (up to 3):\n\nCurrently selected: ${newTags.length > 0 ? newTags.join(', ') : 'none'}`,
      { reply_markup: { inline_keyboard: keyboard } }
    );
    return;
  }
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
  const selectedTags = (currentState.data._selectedTags as string[] | undefined) || [];

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
    tags: selectedTags.length > 0 ? selectedTags : [],
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
// VIEW ITINERARIES & EVENTS (/itineraries, today's events)
// ============================================================

interface ParsedEvent {
  title: string;
  startTime: string;
  endTime: string;
  location?: { name?: string; address?: string; mapsUrl?: string };
  lumaEventUrl?: string;
  eventType?: string;
  dayDate: string;
  itineraryTitle: string;
}

async function handleItineraries(chatId: number, telegramUserId: number) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(chatId, '❌ Your account is not linked yet.\n\nGo to your web app → Contacts → Link Telegram to get started.');
    return;
  }

  const { data: itineraries } = await supabase
    .from('itineraries')
    .select('id, title, start_date, end_date, location, data')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
    .limit(10);

  if (!itineraries || itineraries.length === 0) {
    await sendMessage(chatId, '📅 No itineraries found. Create one with /newitinerary or in the web app.');
    return;
  }

  // Show itinerary list with inline buttons
  const keyboard = itineraries.map((it) => {
    const start = new Date(it.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const end = new Date(it.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const label = `${start}–${end} · ${it.title}`.substring(0, 60);
    return [{ text: label, callback_data: `iv:${it.id}` }];
  });
  keyboard.push([{ text: '📅 Today\'s Events', callback_data: 'iv:today' }]);

  await sendMessage(chatId, '<b>📅 Your Itineraries</b>\n\nSelect one to see its events, or tap "Today\'s Events" for a quick view.', {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleItineraryView(
  chatId: number,
  telegramUserId: number,
  action: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  if (action === 'today') {
    await showTodaysEvents(chatId, userId);
    return;
  }

  // Check if action is "itineraryId:date" (specific day selected)
  const colonIdx = action.indexOf(':');
  const itineraryId = colonIdx > 0 ? action.substring(0, colonIdx) : action;
  const selectedDate = colonIdx > 0 ? action.substring(colonIdx + 1) : null;

  const { data: itinerary } = await supabase
    .from('itineraries')
    .select('id, title, start_date, end_date, location, data')
    .eq('id', itineraryId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!itinerary) {
    await sendMessage(chatId, '❌ Itinerary not found.');
    return;
  }

  const itData = itinerary.data as { days?: Array<{ date: string; events?: Array<Record<string, unknown>> }> };
  const days = itData.days || [];
  const startFmt = new Date(itinerary.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const endFmt = new Date(itinerary.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // "all" — show every event across all days
  if (selectedDate === 'all') {
    const allEvents: ParsedEvent[] = [];
    for (const day of days) {
      for (const ev of day.events || []) {
        allEvents.push({
          title: ev.title as string || 'Untitled',
          startTime: ev.startTime as string || '',
          endTime: ev.endTime as string || '',
          location: ev.location as ParsedEvent['location'],
          lumaEventUrl: ev.lumaEventUrl as string | undefined,
          eventType: ev.eventType as string | undefined,
          dayDate: day.date,
          itineraryTitle: itinerary.title,
        });
      }
    }

    let message = `📅 <b>${itinerary.title}</b>\n📍 ${itinerary.location} · ${startFmt} – ${endFmt}\n${allEvents.length} event${allEvents.length !== 1 ? 's' : ''}\n\n`;
    message += formatEventList(allEvents);

    await sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Back to dates', callback_data: `iv:${itineraryId}` }],
          [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
        ],
      },
    });
    return;
  }

  // If a specific date was selected, show events for that date
  if (selectedDate) {
    const day = days.find((d) => d.date === selectedDate);
    const dayEvents: ParsedEvent[] = [];
    if (day) {
      for (const ev of day.events || []) {
        dayEvents.push({
          title: ev.title as string || 'Untitled',
          startTime: ev.startTime as string || '',
          endTime: ev.endTime as string || '',
          location: ev.location as ParsedEvent['location'],
          lumaEventUrl: ev.lumaEventUrl as string | undefined,
          eventType: ev.eventType as string | undefined,
          dayDate: day.date,
          itineraryTitle: itinerary.title,
        });
      }
    }

    const dateFmt = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    if (dayEvents.length === 0) {
      await sendMessage(chatId, `📅 <b>${itinerary.title}</b>\n📆 ${dateFmt}\n\nNo events on this day.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '◀️ Back to dates', callback_data: `iv:${itineraryId}` }],
          ],
        },
      });
      return;
    }

    let message = `📅 <b>${itinerary.title}</b>\n📆 ${dateFmt}\n${dayEvents.length} event${dayEvents.length !== 1 ? 's' : ''}\n\n`;
    message += formatEventList(dayEvents);

    await sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Back to dates', callback_data: `iv:${itineraryId}` }],
          [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
        ],
      },
    });
    return;
  }

  // No date selected — show date picker for this itinerary
  const totalEvents = days.reduce((sum, d) => sum + (d.events?.length || 0), 0);

  if (totalEvents === 0) {
    await sendMessage(chatId,
      `📅 <b>${itinerary.title}</b>\n📍 ${itinerary.location}\n${startFmt} – ${endFmt}\n\nNo events yet. Add events with /newevent.`
    );
    return;
  }

  let message = `📅 <b>${itinerary.title}</b>\n📍 ${itinerary.location} · ${startFmt} – ${endFmt}\n${totalEvents} event${totalEvents !== 1 ? 's' : ''}\n\nSelect a date to see its events:`;

  // Build date buttons — 2 per row
  const keyboard: Array<Array<{ text: string; callback_data?: string; web_app?: { url: string } }>> = [];
  const todayStr = new Date().toISOString().split('T')[0];

  for (let i = 0; i < days.length; i += 2) {
    const row: Array<{ text: string; callback_data?: string; web_app?: { url: string } }> = [];
    for (let j = i; j < i + 2 && j < days.length; j++) {
      const d = days[j];
      const eventCount = d.events?.length || 0;
      const dateFmt = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const isToday = d.date === todayStr;
      const label = `${isToday ? '📍 ' : ''}${dateFmt} (${eventCount})`;
      row.push({ text: label, callback_data: `iv:${itineraryId}:${d.date}` });
    }
    keyboard.push(row);
  }

  keyboard.push([{ text: '📋 Show all events', callback_data: `iv:${itineraryId}:all` }]);
  keyboard.push([{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }]);

  await sendMessage(chatId, message, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function showTodaysEvents(chatId: number, userId: string) {
  const todayStr = new Date().toISOString().split('T')[0];
  const todayFmt = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const { data: itineraries } = await supabase
    .from('itineraries')
    .select('id, title, start_date, end_date, data')
    .eq('user_id', userId)
    .lte('start_date', todayStr)
    .gte('end_date', todayStr);

  const todayEvents: ParsedEvent[] = [];

  if (itineraries) {
    for (const it of itineraries) {
      const itData = it.data as { days?: Array<{ date: string; events?: Array<Record<string, unknown>> }> };
      for (const day of itData.days || []) {
        if (day.date !== todayStr) continue;
        for (const ev of day.events || []) {
          todayEvents.push({
            title: ev.title as string || 'Untitled',
            startTime: ev.startTime as string || '',
            endTime: ev.endTime as string || '',
            location: ev.location as ParsedEvent['location'],
            lumaEventUrl: ev.lumaEventUrl as string | undefined,
            eventType: ev.eventType as string | undefined,
            dayDate: day.date,
            itineraryTitle: it.title,
          });
        }
      }
    }
  }

  // Sort by start time
  todayEvents.sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (todayEvents.length === 0) {
    await sendMessage(chatId, `📅 <b>Today — ${todayFmt}</b>\n\nNo events scheduled for today.`);
    return;
  }

  let message = `📅 <b>Today — ${todayFmt}</b>\n${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''}\n\n`;
  message += formatEventList(todayEvents);

  await sendMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
      ],
    },
  });
}

function formatEventList(events: ParsedEvent[]): string {
  let message = '';
  let currentDate = '';

  for (const ev of events) {
    // Date header (for multi-day itinerary view)
    if (ev.dayDate !== currentDate) {
      if (currentDate) message += '\n'; // blank line between date sections
      currentDate = ev.dayDate;
      const dateFmt = new Date(ev.dayDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      message += `<b>— ${dateFmt} —</b>\n`;
    }

    // Time range
    let timeStr = '';
    if (ev.startTime) {
      const start = new Date(ev.startTime);
      const startFmt = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      timeStr = startFmt;
      if (ev.endTime) {
        const end = new Date(ev.endTime);
        const endFmt = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        timeStr += ` – ${endFmt}`;
      }
    }

    message += `\n📌 <b>${ev.title}</b>`;
    if (ev.itineraryTitle && events.some((e) => e.itineraryTitle !== ev.itineraryTitle)) {
      // Show itinerary name only if events span multiple itineraries (today's view)
      message += ` <i>(${ev.itineraryTitle})</i>`;
    }
    message += '\n';
    if (timeStr) message += `    🕐 ${timeStr}\n`;

    if (ev.location?.name) {
      message += `    📍 ${ev.location.name}`;
      if (ev.location.mapsUrl) {
        message += ` — <a href="${ev.location.mapsUrl}">Map</a>`;
      }
      message += '\n';
    }

    if (ev.lumaEventUrl) {
      message += `    🔗 <a href="${ev.lumaEventUrl}">Luma Event</a>\n`;
    }
  }

  return message;
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
  const baseData: Record<string, unknown> = { ...currentState.data, itinerary: itData };

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
  const updatedData: Record<string, unknown> = { ...currentState.data, event: eventData };

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
  const baseData: Record<string, unknown> = { ...currentState.data, event: eventData };

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
// FORWARD-TO-FILE (forward a message → auto-create contact)
// ============================================================

async function handleForwardedMessage(
  chatId: number,
  telegramUserId: number,
  msg: Record<string, unknown>
) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(
      chatId,
      '❌ Your account is not linked yet.\n\n' +
        'Go to your web app → Contacts → Link Telegram to get started.'
    );
    return;
  }

  // Extract sender info from forwarded message
  // Support both legacy fields (Bot API <7.0) and forward_origin (Bot API 7.0+)
  const forwardFrom = msg.forward_from as { id?: number; first_name?: string; last_name?: string; username?: string } | undefined;
  const forwardSenderName = msg.forward_sender_name as string | undefined;
  const forwardDate = msg.forward_date as number | undefined;
  const forwardOrigin = msg.forward_origin as {
    type?: string;
    sender_user?: { id?: number; first_name?: string; last_name?: string; username?: string };
    sender_user_name?: string;
    date?: number;
  } | undefined;

  let firstName = '';
  let lastName = '';
  let telegramHandle = '';
  let fwdDate = forwardDate;

  if (forwardFrom) {
    // Legacy field — user allows forwarding identity
    firstName = forwardFrom.first_name || '';
    lastName = forwardFrom.last_name || '';
    if (forwardFrom.username) {
      telegramHandle = `@${forwardFrom.username}`;
    }
  } else if (forwardOrigin) {
    // Bot API 7.0+ — forward_origin object
    if (forwardOrigin.date) fwdDate = forwardOrigin.date;
    if (forwardOrigin.type === 'user' && forwardOrigin.sender_user) {
      firstName = forwardOrigin.sender_user.first_name || '';
      lastName = forwardOrigin.sender_user.last_name || '';
      if (forwardOrigin.sender_user.username) {
        telegramHandle = `@${forwardOrigin.sender_user.username}`;
      }
    } else if (forwardOrigin.type === 'hidden_user' && forwardOrigin.sender_user_name) {
      const parts = forwardOrigin.sender_user_name.split(' ');
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }
  } else if (forwardSenderName) {
    // Legacy fallback — privacy-restricted user, only have display name
    const parts = forwardSenderName.split(' ');
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  } else {
    await sendMessage(
      chatId,
      '❌ Could not extract sender info from this message. Try forwarding a message from the contact.'
    );
    return;
  }

  if (!firstName) {
    await sendMessage(chatId, '❌ Could not determine the sender\'s name.');
    return;
  }

  // Check if this person is already in the user's contacts
  // Normalize handle: strip @ and lowercase for comparison
  const handleNorm = telegramHandle ? telegramHandle.replace(/^@/, '').toLowerCase() : '';
  let existingContact: Record<string, unknown> | null = null;

  if (handleNorm) {
    // Try exact match first (with or without @ prefix), then fuzzy
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, telegram_handle')
      .eq('user_id', userId)
      .or(`telegram_handle.ilike.@${handleNorm},telegram_handle.ilike.${handleNorm}`)
      .limit(1)
      .maybeSingle();
    if (data) existingContact = data;
  }

  if (!existingContact && firstName) {
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, telegram_handle')
      .eq('user_id', userId)
      .ilike('first_name', firstName)
      .ilike('last_name', lastName || '')
      .limit(1)
      .maybeSingle();
    if (data) existingContact = data;
  }

  if (existingContact) {
    // Contact exists — offer to add a note instead
    const cName = `${existingContact.first_name} ${existingContact.last_name || ''}`.trim();
    const msgText = msg.text as string || msg.caption as string || '';
    const preview = msgText ? msgText.substring(0, 100) : '(forwarded message)';

    await setState(telegramUserId, 'forward_note_choice', {
      contactId: existingContact.id,
      contactName: cName,
      noteContent: preview,
      // Also store new contact data in case user wants to create a new one
      _newContactData: { firstName, lastName, telegramHandle },
    });

    await sendMessage(chatId,
      `<b>📋 ${cName}</b> is already in your contacts.\n\n` +
      `Would you like to add a note from this message?\n` +
      `📝 <i>"${preview}"</i>`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📝 Add as note', callback_data: 'fn:note' }],
            [{ text: '👤 Create new contact anyway', callback_data: 'fn:new' }],
            [{ text: '❌ Cancel', callback_data: 'fn:cancel' }],
          ],
        },
      }
    );
    return;
  }

  // Try to match the forward date to an itinerary event
  let matchedItineraryId: string | undefined;
  let matchedEventId: string | undefined;
  let matchedEventTitle: string | undefined;
  let matchedEventDate: string | undefined;

  if (fwdDate) {
    const fwdDateTime = new Date(fwdDate * 1000);
    const fwdDateStr = fwdDateTime.toISOString().split('T')[0];

    // Fetch user's itineraries to find matching events
    const { data: itineraries } = await supabase
      .from('itineraries')
      .select('id, title, start_date, end_date, data')
      .eq('user_id', userId)
      .order('start_date', { ascending: false })
      .limit(10);

    if (itineraries) {
      for (const it of itineraries) {
        if (fwdDateStr < it.start_date || fwdDateStr > it.end_date) continue;

        const itData = it.data as { days?: Array<{ date: string; events?: Array<{ id: string; title: string; startTime: string }> }> };
        for (const day of itData.days || []) {
          if (day.date !== fwdDateStr) continue;
          // Match to the event closest to the forward time, or the first event of that day
          const events = day.events || [];
          if (events.length > 0) {
            // Find the event whose start time is closest to the forward time
            let bestEvent = events[0];
            let bestDiff = Infinity;
            for (const ev of events) {
              const evTime = new Date(ev.startTime).getTime();
              const diff = Math.abs(fwdDateTime.getTime() - evTime);
              if (diff < bestDiff) {
                bestDiff = diff;
                bestEvent = ev;
              }
            }
            matchedItineraryId = it.id;
            matchedEventId = bestEvent.id;
            matchedEventTitle = bestEvent.title;
            matchedEventDate = fwdDateStr;
            break;
          }
        }
        if (matchedEventId) break;
      }
    }
  }

  // Pre-fill contact data
  const contact: Record<string, string> = {
    telegramHandle: telegramHandle || '',
    firstName,
    lastName,
  };

  const stateData: Record<string, unknown> = { contact, _forwardMode: true };
  if (matchedItineraryId) stateData.itineraryId = matchedItineraryId;
  if (matchedEventId) stateData.eventId = matchedEventId;
  if (matchedEventTitle) stateData.eventTitle = matchedEventTitle;
  if (matchedEventDate) stateData.eventDate = matchedEventDate;

  // Show event confirmation step before contact confirmation
  let summary = '<b>📋 Quick-add contact from forwarded message:</b>\n\n';
  summary += `👤 Name: ${firstName}`;
  if (lastName) summary += ` ${lastName}`;
  summary += '\n';
  if (telegramHandle) summary += `💬 Telegram: ${telegramHandle}\n`;
  if (!telegramHandle) summary += '⚠️ No username available (privacy restricted)\n';
  summary += '\n';

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  if (matchedEventTitle) {
    const fmtDate = matchedEventDate
      ? new Date(matchedEventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    summary += `📍 Matched event: <b>${matchedEventTitle}</b>`;
    if (fmtDate) summary += ` (${fmtDate})`;
    summary += '\n\nIs this the right event?';

    keyboard.push([{ text: `✅ Yes — ${matchedEventTitle.substring(0, 30)}`, callback_data: 'fw:yes' }]);
    keyboard.push([{ text: '🔄 Choose a different event', callback_data: 'fw:pick' }]);
    keyboard.push([{ text: '➖ No event — standalone contact', callback_data: 'fw:none' }]);
  } else {
    summary += 'No matching event found.\nWould you like to link this contact to an event?';

    keyboard.push([{ text: '📅 Choose an event', callback_data: 'fw:pick' }]);
    keyboard.push([{ text: '➖ No event — standalone contact', callback_data: 'fw:none' }]);
  }

  keyboard.push([{ text: '❌ Cancel', callback_data: 'fw:cancel' }]);

  await setState(telegramUserId, 'forward_event_choice', stateData);

  await sendMessage(chatId, summary, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleForwardEventChoice(
  chatId: number,
  telegramUserId: number,
  choice: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const currentState = await getState(telegramUserId);
  if (currentState.state !== 'forward_event_choice') {
    await sendMessage(chatId, '❌ Session expired. Forward the message again.');
    return;
  }

  if (choice === 'cancel') {
    await clearState(telegramUserId);
    await sendMessage(chatId, '❌ Cancelled. Use /help for commands.');
    return;
  }

  if (choice === 'yes') {
    // Use the auto-matched event — go straight to contact confirmation
    await showContactConfirmation(chatId, telegramUserId, currentState.data);
    return;
  }

  if (choice === 'none') {
    // No event — remove event info and go to confirmation
    const data = { ...currentState.data };
    delete data.itineraryId;
    delete data.eventId;
    delete data.eventTitle;
    delete data.eventDate;
    await showContactConfirmation(chatId, telegramUserId, data);
    return;
  }

  if (choice === 'pick') {
    // Show itinerary selection — _forwardMode flag in state will route back to confirmation
    const userId = await getLinkedUserId(telegramUserId);
    if (!userId) return;

    const { data: itineraries } = await supabase
      .from('itineraries')
      .select('id, title, start_date, end_date')
      .eq('user_id', userId)
      .order('start_date', { ascending: false })
      .limit(10);

    if (!itineraries || itineraries.length === 0) {
      await sendMessage(chatId, '📅 No itineraries found. Create one in the web app first.');
      // Fall back to no-event confirmation
      const data = { ...currentState.data };
      delete data.itineraryId;
      delete data.eventId;
      delete data.eventTitle;
      delete data.eventDate;
      await showContactConfirmation(chatId, telegramUserId, data);
      return;
    }

    const keyboard = itineraries.map((it) => {
      const start = new Date(it.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const label = `${start} — ${it.title}`.substring(0, 60);
      return [{ text: label, callback_data: `it:${it.id}` }];
    });
    keyboard.push([{ text: '➖ No event — standalone contact', callback_data: 'it:skip' }]);

    await setState(telegramUserId, 'select_itinerary', currentState.data);

    await sendMessage(chatId, '📅 Select the trip this contact is from:', {
      reply_markup: { inline_keyboard: keyboard },
    });
    return;
  }
}

// ============================================================
// FORWARD NOTE CHOICE (fn: callbacks — existing contact found)
// ============================================================

async function handleForwardNoteChoice(
  chatId: number,
  telegramUserId: number,
  choice: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const currentState = await getState(telegramUserId);
  if (currentState.state !== 'forward_note_choice') {
    await sendMessage(chatId, '❌ Session expired. Forward the message again.');
    return;
  }

  if (choice === 'cancel') {
    await clearState(telegramUserId);
    await sendMessage(chatId, '❌ Cancelled. Use /help for commands.');
    return;
  }

  if (choice === 'note') {
    // Add the forwarded message as a note on the existing contact
    const userId = await getLinkedUserId(telegramUserId);
    if (!userId) return;

    const contactId = currentState.data.contactId as string;
    const contactName = currentState.data.contactName as string;
    const noteContent = currentState.data.noteContent as string;

    // Check note limit (max 10)
    const { count } = await supabase
      .from('contact_notes')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contactId);

    if (count !== null && count >= 10) {
      await clearState(telegramUserId);
      await sendMessage(chatId,
        `⚠️ ${contactName} already has 10 notes (maximum). Delete some in the web app to add more.`
      );
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      user_id: userId,
      content: noteContent,
    });

    await clearState(telegramUserId);

    if (error) {
      await sendMessage(chatId, '❌ Failed to save note. Please try again.');
    } else {
      await sendMessage(chatId,
        `✅ Note added to <b>${contactName}</b>:\n📝 <i>"${noteContent}"</i>`
      );
    }
    return;
  }

  if (choice === 'new') {
    // User wants to create a new contact even though one exists
    const newContactData = currentState.data._newContactData as Record<string, string> | undefined;
    const firstName = newContactData?.firstName || '';
    const lastName = newContactData?.lastName || '';
    const telegramHandle = newContactData?.telegramHandle || '';

    // Proceed with the normal forward-to-contact flow: event matching
    // Re-use the existing forward message logic from handleForwardedMessage
    // but skip duplicate detection
    const userId = await getLinkedUserId(telegramUserId);
    if (!userId) return;

    // Try to match to an itinerary event by current date
    const todayStr = new Date().toISOString().split('T')[0];
    let matchedItineraryId: string | undefined;
    let matchedEventId: string | undefined;
    let matchedEventTitle: string | undefined;
    let matchedEventDate: string | undefined;

    const { data: itineraries } = await supabase
      .from('itineraries')
      .select('id, title, start_date, end_date, data')
      .eq('user_id', userId)
      .order('start_date', { ascending: false })
      .limit(10);

    if (itineraries) {
      for (const it of itineraries) {
        if (todayStr < it.start_date || todayStr > it.end_date) continue;
        const itData = it.data as { days?: Array<{ date: string; events?: Array<{ id: string; title: string; startTime: string }> }> };
        for (const day of itData.days || []) {
          if (day.date !== todayStr) continue;
          if (day.events && day.events.length > 0) {
            const ev = day.events[0];
            matchedItineraryId = it.id;
            matchedEventId = ev.id;
            matchedEventTitle = ev.title;
            matchedEventDate = day.date;
          }
          break;
        }
        if (matchedEventId) break;
      }
    }

    const stateData: Record<string, unknown> = {
      firstName,
      lastName,
      telegramHandle: telegramHandle || undefined,
      _forwardMode: true,
    };
    if (matchedItineraryId) stateData.itineraryId = matchedItineraryId;
    if (matchedEventId) stateData.eventId = matchedEventId;
    if (matchedEventTitle) stateData.eventTitle = matchedEventTitle;
    if (matchedEventDate) stateData.eventDate = matchedEventDate;

    if (matchedEventId) {
      await setState(telegramUserId, 'forward_event_choice', stateData);
      await sendMessage(chatId,
        `📅 Matched event: <b>${matchedEventTitle}</b> (${matchedEventDate})\n\nIs this the right event?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Yes, use this event', callback_data: 'fw:yes' }],
              [{ text: '🔄 Pick a different event', callback_data: 'fw:pick' }],
              [{ text: '➖ No event', callback_data: 'fw:none' }],
              [{ text: '❌ Cancel', callback_data: 'fw:cancel' }],
            ],
          },
        }
      );
    } else {
      await showContactConfirmation(chatId, telegramUserId, stateData);
    }
    return;
  }
}

// ============================================================
// CONTACTS LIST & FOLLOW-UP (/contacts, /contacted)
// ============================================================

async function handleContacts(chatId: number, telegramUserId: number) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(
      chatId,
      '❌ Your account is not linked yet.\n\n' +
        'Go to your web app → Contacts → Link Telegram to get started.'
    );
    return;
  }

  // Fetch user's itineraries to let them pick
  const { data: itineraries } = await supabase
    .from('itineraries')
    .select('id, title, location')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
    .limit(10);

  if (!itineraries || itineraries.length === 0) {
    // No itineraries — show all contacts
    await showContactsList(chatId, userId, undefined, undefined, 'All Contacts');
    return;
  }

  // Build itinerary selection keyboard
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: '📋 All Contacts', callback_data: 'cl:all' }],
  ];
  for (const it of itineraries) {
    keyboard.push([{
      text: `${it.title} (${it.location})`,
      callback_data: `cl:${it.id}`,
    }]);
  }

  await sendMessage(chatId, '👥 <b>View contacts</b>\n\nSelect an itinerary or view all:', {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleContactsListSelection(
  chatId: number,
  telegramUserId: number,
  selection: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  if (selection === 'all') {
    await showContactsList(chatId, userId, undefined, undefined, 'All Contacts');
    return;
  }

  // Fetch itinerary with events
  const { data: it } = await supabase
    .from('itineraries')
    .select('id, title, data')
    .eq('id', selection)
    .eq('user_id', userId)
    .single();

  if (!it) {
    await sendMessage(chatId, '❌ Itinerary not found.');
    return;
  }

  // Extract events from itinerary data
  const itData = it.data as { days?: Array<{ date: string; events?: Array<{ id: string; title: string }> }> };
  const events: Array<{ id: string; title: string; date: string }> = [];
  for (const day of itData.days || []) {
    for (const ev of day.events || []) {
      events.push({ id: ev.id, title: ev.title, date: day.date });
    }
  }

  if (events.length === 0) {
    // No events — just show all contacts from this itinerary
    await showContactsList(chatId, userId, it.id, undefined, it.title);
    return;
  }

  // Show event selection with "All from this trip" option
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: `📋 All from ${it.title}`, callback_data: `ce:${it.id}:all` }],
  ];
  for (const ev of events.slice(0, 20)) {
    const date = new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const label = `${date} — ${ev.title}`.substring(0, 60);
    keyboard.push([{ text: label, callback_data: `ce:${it.id}:${ev.id}` }]);
  }
  keyboard.push([{ text: '« Back', callback_data: 'ce:back' }]);

  await sendMessage(chatId, `👥 <b>${it.title}</b>\n\nView all contacts or filter by event:`, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleContactsEventSelection(
  chatId: number,
  telegramUserId: number,
  data: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  // data is "back", "<itineraryId>:all", or "<itineraryId>:<eventId>"
  if (data === 'back') {
    // Re-show the itinerary list
    await handleContacts(chatId, telegramUserId);
    return;
  }

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  const colonIdx = data.indexOf(':');
  if (colonIdx === -1) return;

  const itineraryId = data.substring(0, colonIdx);
  const eventPart = data.substring(colonIdx + 1);

  // Fetch itinerary title
  const { data: it } = await supabase
    .from('itineraries')
    .select('title')
    .eq('id', itineraryId)
    .eq('user_id', userId)
    .single();

  const itTitle = it?.title || 'Trip';

  if (eventPart === 'all') {
    await showContactsList(chatId, userId, itineraryId, undefined, itTitle);
  } else {
    // Find event title from contacts that have this event_id
    const { data: sample } = await supabase
      .from('contacts')
      .select('event_title')
      .eq('event_id', eventPart)
      .eq('user_id', userId)
      .limit(1)
      .single();

    const label = sample?.event_title || 'Event';
    await showContactsList(chatId, userId, itineraryId, eventPart, `${itTitle} → ${label}`);
  }
}

async function showContactsList(
  chatId: number,
  userId: string,
  itineraryId: string | undefined,
  eventId: string | undefined,
  label: string
) {
  let query = supabase
    .from('contacts')
    .select('id, first_name, last_name, telegram_handle, project_company, event_title, last_contacted_at, tags')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (itineraryId) {
    query = query.eq('itinerary_id', itineraryId);
  }
  if (eventId) {
    query = query.eq('event_id', eventId);
  }

  const { data: contacts } = await query.limit(50);

  if (!contacts || contacts.length === 0) {
    await sendMessage(chatId, `📋 <b>${label}</b>\n\nNo contacts found.`);
    return;
  }

  // Fetch last 3 notes per contact in a single query
  const contactIds = contacts.map((c) => c.id as string);
  const { data: allNotes } = await supabase
    .from('contact_notes')
    .select('contact_id, content, created_at')
    .in('contact_id', contactIds)
    .order('created_at', { ascending: false });

  // Group notes by contact_id, keeping only the 3 most recent
  const notesByContact = new Map<string, Array<{ content: string; created_at: string }>>();
  if (allNotes) {
    for (const n of allNotes) {
      const cid = n.contact_id as string;
      const list = notesByContact.get(cid) || [];
      if (list.length < 3) {
        list.push({ content: n.content as string, created_at: n.created_at as string });
        notesByContact.set(cid, list);
      }
    }
  }

  let message = `📋 <b>${label}</b> (${contacts.length} contact${contacts.length !== 1 ? 's' : ''})\n\n`;

  for (const c of contacts) {
    const cId = c.id as string;
    const name = `${c.first_name} ${c.last_name || ''}`.trim();
    const company = c.project_company ? ` — ${c.project_company}` : '';
    const handle = c.telegram_handle ? c.telegram_handle.replace('@', '') : '';

    message += `👤 <b>${name}</b>${company}\n`;

    if (handle) {
      message += `    💬 <a href="tg://resolve?domain=${handle}">@${handle}</a>`;
    }

    if (c.last_contacted_at) {
      const d = new Date(c.last_contacted_at);
      const ago = getTimeAgo(d);
      message += ` · 📅 ${ago}`;
    }

    message += '\n';

    if (c.event_title) {
      message += `    📍 ${c.event_title}\n`;
    }

    const cTags = Array.isArray(c.tags) ? c.tags as string[] : [];
    if (cTags.length > 0) {
      message += `    🏷 ${cTags.join(', ')}\n`;
    }

    const notes = notesByContact.get(cId);
    if (notes && notes.length > 0) {
      for (const note of notes) {
        const noteDate = new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const preview = note.content.length > 60 ? note.content.substring(0, 57) + '...' : note.content;
        message += `    📝 <i>${noteDate}: ${preview}</i>\n`;
      }
    }

    message += '\n';
  }

  message += 'Tap a username to open their DM.\n';
  message += 'Use <code>/contacted @handle</code> to mark as contacted.';

  await sendMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
      ],
    },
  });
}

function getTimeAgo(date: Date): string {
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

async function handleContacted(
  chatId: number,
  telegramUserId: number,
  args: string
) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(
      chatId,
      '❌ Your account is not linked yet.\n\n' +
        'Go to your web app → Contacts → Link Telegram to get started.'
    );
    return;
  }

  const handle = args.trim();
  if (!handle) {
    await sendMessage(
      chatId,
      '❌ Please provide a Telegram handle.\n\n' +
        'Usage: <code>/contacted @handle</code>'
    );
    return;
  }

  // Normalize — ensure it starts with @
  const normalized = handle.startsWith('@') ? handle : `@${handle}`;

  // Find contacts with this handle
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, first_name, last_name')
    .eq('user_id', userId)
    .eq('telegram_handle', normalized);

  if (error || !contacts || contacts.length === 0) {
    await sendMessage(
      chatId,
      `❌ No contacts found with handle <b>${normalized}</b>.`
    );
    return;
  }

  // Update last_contacted_at for all matching contacts
  const now = new Date().toISOString();
  await supabase
    .from('contacts')
    .update({ last_contacted_at: now })
    .eq('user_id', userId)
    .eq('telegram_handle', normalized);

  const names = contacts.map((c) => `${c.first_name} ${c.last_name || ''}`.trim());
  const nameList = names.length === 1 ? names[0] : names.join(', ');

  await sendMessage(
    chatId,
    `✅ Marked <b>${nameList}</b> (${normalized}) as contacted just now.`
  );
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

  // Verify webhook secret (constant-time comparison to prevent timing attacks)
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
  if (
    typeof secretHeader !== 'string' ||
    secretHeader.length !== WEBHOOK_SECRET.length ||
    !crypto.timingSafeEqual(Buffer.from(secretHeader), Buffer.from(WEBHOOK_SECRET))
  ) {
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

      // Check for forwarded messages first — auto-create contact from sender
      // Support both legacy (forward_from/forward_sender_name) and Bot API 7.0+ (forward_origin)
      if (msg.forward_from || msg.forward_sender_name || msg.forward_origin) {
        await handleForwardedMessage(chatId, telegramUserId, msg);
      } else if (text.startsWith('/start')) {
        const args = text.substring('/start'.length).trim();
        await handleStart(chatId, telegramUserId, telegramUsername, args);
      } else if (text === '/newcontact') {
        await handleNewContact(chatId, telegramUserId);
      } else if (text === '/newitinerary') {
        await handleNewItinerary(chatId, telegramUserId);
      } else if (text === '/newevent') {
        await handleNewEvent(chatId, telegramUserId);
      } else if (text === '/itineraries' || text === '/events') {
        await handleItineraries(chatId, telegramUserId);
      } else if (text === '/today') {
        const userId = await getLinkedUserId(telegramUserId);
        if (userId) await showTodaysEvents(chatId, userId);
        else await sendMessage(chatId, '❌ Your account is not linked yet.');
      } else if (text === '/contacts') {
        await handleContacts(chatId, telegramUserId);
      } else if (text.startsWith('/contacted')) {
        const args = text.substring('/contacted'.length).trim();
        await handleContacted(chatId, telegramUserId, args);
      } else if (text === '/cancel') {
        await clearState(telegramUserId);
        await sendMessage(chatId, '❌ Cancelled. Use /help for commands.');
      } else if (text === '/help') {
        await sendMessage(
          chatId,
          '<b>📖 Command Reference</b>\n\n' +
            '📋 <b>Trip Planning</b>\n' +
            '/newitinerary — Create a new trip with dates & location\n' +
            '/newevent — Add an event to a trip (manual or Luma import)\n' +
            '/itineraries — View your trips and events with Luma & map links\n' +
            '/today — Quick view of today\'s events across all trips\n\n' +
            '👥 <b>Contact Management</b>\n' +
            '/newcontact — Add a contact linked to a trip/event\n' +
            '/contacts — Browse contacts by trip, event, or all\n' +
            '/contacted @handle — Mark that you\'ve reached out to someone\n\n' +
            '⚡ <b>Quick Actions</b>\n' +
            '• <b>Forward a message</b> → if the sender is already a contact, save it as a timestamped note; otherwise create a new contact\n' +
            '• <b>Paste Luma links</b> during /newevent → auto-imports event details\n\n' +
            '🏷 <b>Tags & Notes</b>\n' +
            '• Tag contacts in the web app (e.g., investor, developer) and filter by tag\n' +
            '• Add timestamped notes to track relationship history\n' +
            '• Tags are visible when browsing /contacts\n\n' +
            '🌐 <b>Web App Features</b>\n' +
            '• <b>Invite</b> — Bulk-compose personalized messages\n' +
            '• <b>Export CSV</b> — Download contacts as a spreadsheet\n' +
            '• Search, sort, and filter contacts by tags or text\n\n' +
            '/cancel — Cancel current operation',
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
      // --- Itinerary view callbacks ---
      else if (data.startsWith('iv:')) {
        await handleItineraryView(chatId, telegramUserId, data.substring(3), cq.id);
      }
      // --- Tag selection callbacks ---
      else if (data.startsWith('tg:')) {
        await handleTagSelection(chatId, telegramUserId, data.substring(3), cq.id);
      }
      // --- Forward event choice callbacks ---
      else if (data.startsWith('fw:')) {
        await handleForwardEventChoice(chatId, telegramUserId, data.substring(3), cq.id);
      }
      // --- Forward note choice callbacks (existing contact found) ---
      else if (data.startsWith('fn:')) {
        await handleForwardNoteChoice(chatId, telegramUserId, data.substring(3), cq.id);
      }
      // --- Contacts list callbacks ---
      else if (data.startsWith('cl:')) {
        await handleContactsListSelection(chatId, telegramUserId, data.substring(3), cq.id);
      }
      else if (data.startsWith('ce:')) {
        await handleContactsEventSelection(chatId, telegramUserId, data.substring(3), cq.id);
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
