// /newevent flow — event creation with Luma import support

import crypto from 'crypto';
import { supabase, WEBAPP_URL } from '../_lib/config';
import { sendMessage, answerCallbackQuery } from '../_lib/telegram';
import { getState, setState, clearState, getLinkedUserId } from '../_lib/state';
import { escapeHtml, isValidTime, padTime, getEventTypeLabel, EVENT_TYPE_OPTIONS, EVENT_TYPE_KEYBOARD } from '../_lib/utils';
import { extractLumaUrls, fetchLumaEvent } from '../_lib/luma';
import type { BotState } from '../_lib/types';

export async function handleNewEvent(chatId: number, telegramUserId: number) {
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

export async function handleNewEventItSelection(
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
    `📅 Select a day from <b>${escapeHtml(itinerary.title)}</b>:`,
    { reply_markup: { inline_keyboard: keyboard } }
  );
}

export async function handleLumaImportSelect(
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

export async function handleLumaInput(
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
      results.push(`❌ <b>${escapeHtml(eventData.title)}</b> — no date/time found`);
      continue;
    }

    // Parse the event's date
    const eventStart = new Date(eventData.startTime);
    if (isNaN(eventStart.getTime())) {
      results.push(`❌ <b>${escapeHtml(eventData.title)}</b> — invalid date`);
      continue;
    }

    const eventDateStr = eventStart.toISOString().split('T')[0];

    // Check if event falls within itinerary date range
    if (eventDateStr < itStartDate || eventDateStr > itEndDate) {
      const fmtDate = eventStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      results.push(
        `⏭ <b>${escapeHtml(eventData.title)}</b> — ${fmtDate} is outside the trip dates (${itStartDate} to ${itEndDate})`
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
      results.push(`⏭ <b>${escapeHtml(eventData.title)}</b> — already in this itinerary`);
      continue;
    }

    // Find the matching day
    const dayIndex = itData.days.findIndex((d) => d.date === eventDateStr);
    if (dayIndex === -1) {
      results.push(`⏭ <b>${escapeHtml(eventData.title)}</b> — no matching day found`);
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
    results.push(`✅ <b>${escapeHtml(eventData.title)}</b> — added to ${fmtDate} (${startTimeStr}–${endTimeStr})`);
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

  let summary = `<b>🔗 Luma Import — ${escapeHtml(itineraryTitle)}</b>\n\n`;
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

export async function handleNewEventDaySelection(
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

export async function handleNewEventTypeSelection(
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

export async function handleEventTextInput(
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

export async function showEventConfirmation(
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
  summary += `📅 ${escapeHtml(itTitle)} → ${fmtDate}\n\n`;
  summary += `🏷 Title: ${escapeHtml(ev.title)}\n`;
  summary += `🎯 Type: ${getEventTypeLabel(ev.eventType)}\n`;
  summary += `🕐 Time: ${ev.startTime} — ${ev.endTime}\n`;
  if (ev.locationName) {
    summary += `📍 Location: ${escapeHtml(ev.locationName)}\n`;
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

export async function handleEventConfirmation(
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
      `<b>${escapeHtml(ev.title)}</b>\n` +
      `${getEventTypeLabel(ev.eventType)} · ${ev.startTime} — ${ev.endTime}\n` +
      `📅 ${fmtDate}\n` +
      (ev.locationName ? `📍 ${escapeHtml(ev.locationName)}\n` : '') +
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

export async function handleEventEdit(
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
