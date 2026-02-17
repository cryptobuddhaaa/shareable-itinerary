/**
 * Vercel Serverless Function: Telegram Bot Webhook
 * POST /api/telegram/webhook
 *
 * Handles all incoming Telegram updates for the contact bot.
 * Conversation flow: /add → select itinerary → select event → input fields → confirm → save
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

// --- Command handlers ---
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
          'Use /add to add a new contact.\n' +
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
        '👋 Welcome to Itinerary Contact Bot!\n\n' +
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
    '✅ Account linked successfully!\n\nUse /add to add a new contact.'
  );
}

async function handleAdd(chatId: number, telegramUserId: number) {
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

// --- Field input handlers ---
// Each entry: when in this `state`, save user input to `field`, then move to the next entry.
// `prompt` is the message shown when ENTERING this state.
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
    await showConfirmation(chatId, telegramUserId, stateData);
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

async function handleTextInput(
  chatId: number,
  telegramUserId: number,
  text: string
) {
  const currentState = await getState(telegramUserId);
  const currentIndex = getFieldIndex(currentState.state);

  if (currentIndex === -1) {
    await sendMessage(
      chatId,
      'Use /add to add a new contact or /help for commands.'
    );
    return;
  }

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
    await showConfirmation(chatId, telegramUserId, updatedData);
    return;
  }

  await goToNextField(chatId, telegramUserId, updatedData, currentIndex);
}

async function handleSkip(
  chatId: number,
  telegramUserId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const currentState = await getState(telegramUserId);
  const currentIndex = getFieldIndex(currentState.state);
  if (currentIndex === -1) return;

  const contact = { ...(currentState.data.contact as Record<string, string>) };

  await goToNextField(chatId, telegramUserId, { ...currentState.data, contact }, currentIndex);
}

/** Handle edit button from confirmation — re-enter a specific field, then return to confirmation. */
async function handleEdit(
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

// --- Confirmation & Save ---
async function showConfirmation(
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

async function handleConfirmation(
  chatId: number,
  telegramUserId: number,
  confirmed: boolean,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  if (!confirmed) {
    await clearState(telegramUserId);
    await sendMessage(chatId, '❌ Cancelled. Use /add to start over.');
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
      `→ ${eventTitle}\n\n` +
      'Use /add to add another contact.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
        ],
      },
    }
  );
}

// --- Main handler ---
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
      } else if (text === '/add') {
        await handleAdd(chatId, telegramUserId);
      } else if (text === '/cancel') {
        await clearState(telegramUserId);
        await sendMessage(chatId, '❌ Cancelled. Use /add to start over.');
      } else if (text === '/help') {
        await sendMessage(
          chatId,
          '<b>Available commands:</b>\n\n' +
            '/add — Add a new contact\n' +
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

      if (data.startsWith('it:')) {
        await handleItinerarySelection(chatId, telegramUserId, data.substring(3), cq.id);
      } else if (data.startsWith('ev:')) {
        await handleEventSelection(chatId, telegramUserId, data.substring(3), cq.id);
      } else if (data === 'skip') {
        await handleSkip(chatId, telegramUserId, cq.id);
      } else if (data.startsWith('cf:')) {
        await handleConfirmation(chatId, telegramUserId, data === 'cf:yes', cq.id);
      } else if (data.startsWith('ed:')) {
        const fieldIndex = parseInt(data.substring(3), 10);
        await handleEdit(chatId, telegramUserId, fieldIndex, cq.id);
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
