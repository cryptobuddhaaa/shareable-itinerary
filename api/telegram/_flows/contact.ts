// /newcontact flow — contact creation with field-by-field input

import { supabase, WEBAPP_URL } from '../_lib/config';
import { sendMessage, answerCallbackQuery } from '../_lib/telegram';
import { getState, setState, clearState, getLinkedUserId } from '../_lib/state';
import { escapeHtml } from '../_lib/utils';
import type { BotState, EventInfo, FieldConfig } from '../_lib/types';
import { showEventConfirmation } from './event';

// --- Contact field input flow ---
export const FIELD_FLOW: FieldConfig[] = [
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

export function getFieldIndex(state: string): number {
  return FIELD_FLOW.findIndex((f) => f.state === state);
}

/** Transition to the next field in the flow, or show confirmation if done. */
export async function goToNextField(
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

export async function handleNewContact(chatId: number, telegramUserId: number) {
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

export async function handleItinerarySelection(
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
      `📅 No events found in "${escapeHtml(itinerary.title)}". Add events in the web app first.`
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
    `📅 Select the event from <b>${escapeHtml(itinerary.title)}</b>:`,
    { reply_markup: { inline_keyboard: keyboard } }
  );
}

export async function handleEventSelection(
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
      `📝 Adding contact to: <b>${escapeHtml(selectedEvent.title)}</b>\n\n` +
        'Enter their <b>Telegram handle</b> (required):\n' +
        '<i>e.g. @johndoe</i>'
    );
  }
}

export async function handleContactTextInput(
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

export async function handleSkip(
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
export async function handleContactEdit(
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
export async function showContactConfirmation(
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
    summary += `📍 ${escapeHtml(itineraryTitle)} → ${escapeHtml(eventTitle)}\n\n`;
  } else if (itineraryTitle) {
    summary += `📍 ${escapeHtml(itineraryTitle)}\n\n`;
  } else {
    summary += '📍 Standalone contact\n\n';
  }
  summary += `💬 Telegram: ${escapeHtml(contact.telegramHandle)}\n`;
  summary += `👤 Name: ${escapeHtml(contact.firstName)}`;
  if (contact.lastName) summary += ` ${escapeHtml(contact.lastName)}`;
  summary += '\n';
  if (contact.projectCompany) summary += `🏢 Company: ${escapeHtml(contact.projectCompany)}\n`;
  if (contact.position) summary += `💼 Position: ${escapeHtml(contact.position)}\n`;
  if (contact.notes) summary += `📝 Notes: ${escapeHtml(contact.notes)}\n`;
  if (selectedTags.length > 0) summary += `🏷 Labels: ${selectedTags.map(escapeHtml).join(', ')}\n`;

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

export async function handleTagSelection(
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

export async function handleContactConfirmation(
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
      `<b>${escapeHtml(displayName)}</b>${escapeHtml(company)}\n` +
      (eventTitle ? `→ ${escapeHtml(eventTitle)}\n\n` : '\n') +
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
