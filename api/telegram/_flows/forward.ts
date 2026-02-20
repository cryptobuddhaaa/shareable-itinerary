// Forward-to-contact flow — auto-create contact from forwarded messages

import { supabase } from '../_lib/config';
import { sendMessage, answerCallbackQuery } from '../_lib/telegram';
import { getState, setState, clearState, getLinkedUserId } from '../_lib/state';
import { escapeHtml, truncateInput } from '../_lib/utils';
import { showContactConfirmation } from './contact';

export async function handleForwardedMessage(
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
      `<b>📋 ${escapeHtml(cName)}</b> is already in your contacts.\n\n` +
      `Would you like to add a note from this message?\n` +
      `📝 <i>"${escapeHtml(preview)}"</i>`,
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
  summary += `👤 Name: ${escapeHtml(firstName)}`;
  if (lastName) summary += ` ${escapeHtml(lastName)}`;
  summary += '\n';
  if (telegramHandle) summary += `💬 Telegram: ${escapeHtml(telegramHandle)}\n`;
  if (!telegramHandle) summary += '⚠️ No username available (privacy restricted)\n';
  summary += '\n';

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  if (matchedEventTitle) {
    const fmtDate = matchedEventDate
      ? new Date(matchedEventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    summary += `📍 Matched event: <b>${escapeHtml(matchedEventTitle)}</b>`;
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

export async function handleForwardEventChoice(
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

export async function handleForwardNoteChoice(
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
        `⚠️ ${escapeHtml(contactName)} already has 10 notes (maximum). Delete some in the web app to add more.`
      );
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      user_id: userId,
      content: truncateInput(noteContent, 1000),
    });

    await clearState(telegramUserId);

    if (error) {
      await sendMessage(chatId, '❌ Failed to save note. Please try again.');
    } else {
      await sendMessage(chatId,
        `✅ Note added to <b>${escapeHtml(contactName)}</b>:\n📝 <i>"${escapeHtml(noteContent)}"</i>`
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
        `📅 Matched event: <b>${escapeHtml(matchedEventTitle || '')}</b> (${matchedEventDate})\n\nIs this the right event?`,
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
