// /contacts, /itineraries, /today — read-only viewing flows

import { supabase, WEBAPP_URL } from '../_lib/config';
import { sendMessage, answerCallbackQuery } from '../_lib/telegram';
import { getLinkedUserId } from '../_lib/state';
import { escapeHtml, isSafeUrl, sanitizeHandle, getTimeAgo } from '../_lib/utils';
import type { ParsedEvent } from '../_lib/types';

export async function handleItineraries(chatId: number, telegramUserId: number) {
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

export async function handleItineraryView(
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

    let message = `📅 <b>${escapeHtml(itinerary.title)}</b>\n📍 ${escapeHtml(itinerary.location)} · ${startFmt} – ${endFmt}\n${allEvents.length} event${allEvents.length !== 1 ? 's' : ''}\n\n`;
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
      await sendMessage(chatId, `📅 <b>${escapeHtml(itinerary.title)}</b>\n📆 ${dateFmt}\n\nNo events on this day.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '◀️ Back to dates', callback_data: `iv:${itineraryId}` }],
          ],
        },
      });
      return;
    }

    let message = `📅 <b>${escapeHtml(itinerary.title)}</b>\n📆 ${dateFmt}\n${dayEvents.length} event${dayEvents.length !== 1 ? 's' : ''}\n\n`;
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
      `📅 <b>${escapeHtml(itinerary.title)}</b>\n📍 ${escapeHtml(itinerary.location)}\n${startFmt} – ${endFmt}\n\nNo events yet. Add events with /newevent.`
    );
    return;
  }

  let message = `📅 <b>${escapeHtml(itinerary.title)}</b>\n📍 ${escapeHtml(itinerary.location)} · ${startFmt} – ${endFmt}\n${totalEvents} event${totalEvents !== 1 ? 's' : ''}\n\nSelect a date to see its events:`;

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

export async function showTodaysEvents(chatId: number, userId: string) {
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

    message += `\n📌 <b>${escapeHtml(ev.title)}</b>`;
    if (ev.itineraryTitle && events.some((e) => e.itineraryTitle !== ev.itineraryTitle)) {
      // Show itinerary name only if events span multiple itineraries (today's view)
      message += ` <i>(${escapeHtml(ev.itineraryTitle)})</i>`;
    }
    message += '\n';
    if (timeStr) message += `    🕐 ${timeStr}\n`;

    if (ev.location?.name) {
      message += `    📍 ${escapeHtml(ev.location.name)}`;
      if (ev.location.mapsUrl && isSafeUrl(ev.location.mapsUrl)) {
        message += ` — <a href="${escapeHtml(ev.location.mapsUrl)}">Map</a>`;
      }
      message += '\n';
    }

    if (ev.lumaEventUrl && isSafeUrl(ev.lumaEventUrl)) {
      message += `    🔗 <a href="${escapeHtml(ev.lumaEventUrl)}">Luma Event</a>\n`;
    }
  }

  return message;
}

// --- Contacts browsing ---

export async function handleContacts(chatId: number, telegramUserId: number) {
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

export async function handleContactsListSelection(
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

  await sendMessage(chatId, `👥 <b>${escapeHtml(it.title)}</b>\n\nView all contacts or filter by event:`, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function handleContactsEventSelection(
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
    await sendMessage(chatId, `📋 <b>${escapeHtml(label)}</b>\n\nNo contacts found.`);
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

  let message = `📋 <b>${escapeHtml(label)}</b> (${contacts.length} contact${contacts.length !== 1 ? 's' : ''})\n\n`;

  for (const c of contacts) {
    const cId = c.id as string;
    const name = escapeHtml(`${c.first_name} ${c.last_name || ''}`.trim());
    const company = c.project_company ? ` — ${escapeHtml(c.project_company)}` : '';
    const handle = c.telegram_handle ? sanitizeHandle(c.telegram_handle.replace('@', '')) : '';

    message += `👤 <b>${name}</b>${company}\n`;

    if (handle) {
      message += `    💬 <a href="tg://resolve?domain=${handle}">@${escapeHtml(handle)}</a>`;
    }

    if (c.last_contacted_at) {
      const d = new Date(c.last_contacted_at);
      const ago = getTimeAgo(d);
      message += ` · 📅 ${ago}`;
    }

    message += '\n';

    if (c.event_title) {
      message += `    📍 ${escapeHtml(c.event_title)}\n`;
    }

    const cTags = Array.isArray(c.tags) ? c.tags as string[] : [];
    if (cTags.length > 0) {
      message += `    🏷 ${cTags.map(escapeHtml).join(', ')}\n`;
    }

    const notes = notesByContact.get(cId);
    if (notes && notes.length > 0) {
      for (const note of notes) {
        const noteDate = new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const preview = note.content.length > 60 ? note.content.substring(0, 57) + '...' : note.content;
        message += `    📝 <i>${noteDate}: ${escapeHtml(preview)}</i>\n`;
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

export async function handleContacted(
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
      `❌ No contacts found with handle <b>${escapeHtml(normalized)}</b>.`
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
    `✅ Marked <b>${escapeHtml(nameList)}</b> (${escapeHtml(normalized)}) as contacted just now.`
  );
}
