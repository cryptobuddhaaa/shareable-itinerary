// /newitinerary flow — itinerary creation

import { supabase, WEBAPP_URL } from '../_lib/config';
import { sendMessage, answerCallbackQuery } from '../_lib/telegram';
import { getState, setState, clearState, getLinkedUserId } from '../_lib/state';
import { escapeHtml, isValidDate } from '../_lib/utils';
import type { BotState } from '../_lib/types';

export async function handleNewItinerary(chatId: number, telegramUserId: number) {
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

export async function handleItineraryTextInput(
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

export async function showItineraryConfirmation(
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
  summary += `🏷 Title: ${escapeHtml(it.title)}\n`;
  summary += `📍 Location: ${escapeHtml(it.location)}\n`;
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

export async function handleItineraryConfirmation(
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
      `<b>${escapeHtml(it.title)}</b>\n` +
      `📍 ${escapeHtml(it.location)}\n` +
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

export async function handleItineraryEdit(
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
