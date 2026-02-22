/**
 * Vercel Serverless Function: Telegram Bot Webhook
 * POST /api/telegram/webhook
 *
 * Thin dispatcher — all logic lives in ./lib/ and ./flows/ modules.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { WEBHOOK_SECRET, WEBAPP_URL, BOT_TOKEN } from './_lib/config.js';
import { sendMessage } from './_lib/telegram.js';
import { getState, clearState, getLinkedUserId } from './_lib/state.js';

// --- Flows ---
import { handleStart } from './_flows/account.js';
import {
  handleNewContact,
  handleItinerarySelection,
  handleEventSelection,
  handleContactTextInput,
  handleSkip,
  handleContactEdit,
  handleTagSelection,
  handleContactConfirmation,
} from './_flows/contact.js';
import {
  handleNewItinerary,
  handleItineraryTextInput,
  handleItineraryConfirmation,
  handleItineraryEdit,
} from './_flows/itinerary.js';
import {
  handleNewEvent,
  handleNewEventItSelection,
  handleLumaImportSelect,
  handleNewEventDaySelection,
  handleNewEventTypeSelection,
  handleEventTextInput,
  handleEventConfirmation,
  handleEventEdit,
} from './_flows/event.js';
import {
  handleForwardedMessage,
  handleForwardEventChoice,
  handleForwardNoteChoice,
} from './_flows/forward.js';
import {
  handleItineraries,
  handleItineraryView,
  showTodaysEvents,
  handleContacts,
  handleContactsListSelection,
  handleContactsEventSelection,
  handleContacted,
} from './_flows/contacts-view.js';
import {
  handleHandshake,
  handleHandshakeSelection,
} from './_flows/handshake.js';
import {
  handlePoints,
  handleTrust,
  handleMyHandshakes,
} from './_flows/trust-points.js';

// --- Text input router ---

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

// --- Main handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET /api/telegram/webhook — diagnostic endpoint (no secrets exposed)
  if (req.method === 'GET') {
    const hasToken = !!BOT_TOKEN && BOT_TOKEN.length > 10;
    return res.status(200).json({
      status: 'ok',
      botTokenConfigured: hasToken,
      webhookSecretLength: WEBHOOK_SECRET.length,
      hint: hasToken
        ? 'Bot token is set. If bot is not responding, re-register the webhook via POST /api/telegram/setup.'
        : 'TELEGRAM_BOT_TOKEN is NOT set in environment variables. Set it in Vercel → Settings → Environment Variables.',
    });
  }

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
    console.error('[Webhook] Secret mismatch — received length:', secretHeader?.length, 'expected:', WEBHOOK_SECRET.length);
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
        await handleStart(chatId, telegramUserId, telegramUsername, args, {
          is_premium: msg.from.is_premium,
          has_profile_photo: msg.from.has_profile_photo,
        });
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
      } else if (text.startsWith('/handshake')) {
        const args = text.substring('/handshake'.length).trim();
        await handleHandshake(chatId, telegramUserId, args);
      } else if (text === '/points') {
        await handlePoints(chatId, telegramUserId);
      } else if (text === '/trust') {
        await handleTrust(chatId, telegramUserId);
      } else if (text === '/shakehistory') {
        await handleMyHandshakes(chatId, telegramUserId);
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
            '🤝 <b>Proof of Handshake</b>\n' +
            '/handshake — Send a handshake to a contact\n' +
            '/handshake @handle — Send directly by Telegram handle\n' +
            '/shakehistory — View your handshake history\n' +
            '/points — Check your points balance\n' +
            '/trust — View your trust score breakdown\n\n' +
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
      // --- Handshake callbacks ---
      else if (data.startsWith('hs:')) {
        await handleHandshakeSelection(chatId, telegramUserId, data.substring(3), cq.id);
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
