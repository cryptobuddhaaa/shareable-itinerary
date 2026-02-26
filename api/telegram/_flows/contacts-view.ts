// /contacts, /itineraries, /today — viewing flows + edit/delete contacts

import { supabase, WEBAPP_URL } from '../_lib/config.js';
import { sendMessage, answerCallbackQuery } from '../_lib/telegram.js';
import { getLinkedUserId, setState, clearState } from '../_lib/state.js';
import { escapeHtml, isSafeUrl, sanitizeHandle, getTimeAgo } from '../_lib/utils.js';
import type { BotState, ParsedEvent } from '../_lib/types.js';
import { FIELD_FLOW } from './contact.js';

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

  message += 'Tap a contact below to view, edit, or delete:';

  // Per-contact selection buttons (max 20 to stay within Telegram limits)
  const keyboard: Array<Array<{ text: string; callback_data?: string; web_app?: { url: string } }>> = [];
  for (const c of contacts.slice(0, 20)) {
    const name = `${c.first_name} ${c.last_name || ''}`.trim();
    const company = c.project_company ? ` — ${c.project_company}` : '';
    keyboard.push([{
      text: `👤 ${name}${company}`.substring(0, 60),
      callback_data: `cv:${c.id}`,
    }]);
  }
  keyboard.push([{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }]);

  await sendMessage(chatId, message, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

// --- Contact detail view & edit/delete ---

const FIELD_COLUMN_MAP: Record<string, string> = {
  telegramHandle: 'telegram_handle',
  firstName: 'first_name',
  lastName: 'last_name',
  projectCompany: 'project_company',
  position: 'position',
  notes: 'notes',
};

export async function showContactDetail(
  chatId: number,
  userId: string,
  contactId: string
) {
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, telegram_handle, project_company, position, notes, email, linkedin, event_title, date_met, last_contacted_at, tags')
    .eq('id', contactId)
    .eq('user_id', userId)
    .single();

  if (!contact) {
    await sendMessage(chatId, '❌ Contact not found.');
    return;
  }

  const name = `${contact.first_name} ${contact.last_name || ''}`.trim();
  let message = `👤 <b>${escapeHtml(name)}</b>\n\n`;

  if (contact.telegram_handle) {
    const handle = sanitizeHandle(contact.telegram_handle.replace('@', ''));
    message += `💬 Telegram: <a href="tg://resolve?domain=${handle}">@${escapeHtml(handle)}</a>\n`;
  }
  if (contact.project_company) message += `🏢 Company: ${escapeHtml(contact.project_company)}\n`;
  if (contact.position) message += `💼 Position: ${escapeHtml(contact.position)}\n`;
  if (contact.email) message += `📧 Email: ${escapeHtml(contact.email)}\n`;
  if (contact.linkedin) message += `🔗 LinkedIn: ${escapeHtml(contact.linkedin)}\n`;
  if (contact.notes) message += `📝 Notes: ${escapeHtml(contact.notes)}\n`;

  const tags = Array.isArray(contact.tags) ? contact.tags as string[] : [];
  if (tags.length > 0) message += `🏷 Labels: ${tags.map(escapeHtml).join(', ')}\n`;

  if (contact.event_title) message += `\n📍 ${escapeHtml(contact.event_title)}`;
  if (contact.date_met) {
    const d = new Date(contact.date_met).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    message += contact.event_title ? ` · ${d}` : `\n📅 Met: ${d}`;
  }
  if (contact.event_title || contact.date_met) message += '\n';

  if (contact.last_contacted_at) {
    const ago = getTimeAgo(new Date(contact.last_contacted_at));
    message += `✅ Contacted ${ago}\n`;
  }

  const cid = contact.id as string;
  await sendMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✏️ Telegram', callback_data: `cx:e:0:${cid}` },
          { text: '✏️ Name', callback_data: `cx:e:1:${cid}` },
          { text: '✏️ Company', callback_data: `cx:e:3:${cid}` },
        ],
        [
          { text: '✏️ Position', callback_data: `cx:e:4:${cid}` },
          { text: '✏️ Notes', callback_data: `cx:e:5:${cid}` },
          { text: `🏷 Labels${tags.length > 0 ? ` (${tags.length})` : ''}`, callback_data: `cx:t:${cid}` },
        ],
        [
          { text: '🗑 Delete', callback_data: `cx:d:${cid}` },
          { text: '« Back', callback_data: 'cx:back' },
        ],
      ],
    },
  });
}

export async function handleContactDetailCallback(
  chatId: number,
  telegramUserId: number,
  contactId: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  await showContactDetail(chatId, userId, contactId);
}

export async function handleContactActionCallback(
  chatId: number,
  telegramUserId: number,
  action: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  // cx:back — return to /contacts
  if (action === 'back') {
    await handleContacts(chatId, telegramUserId);
    return;
  }

  // cx:dn — cancel delete
  if (action === 'dn') {
    await sendMessage(chatId, '❌ Delete cancelled.');
    return;
  }

  // cx:d:<contactId> — show delete confirmation
  if (action.startsWith('d:') && !action.startsWith('dy:')) {
    const contactId = action.substring(2);
    const { data: contact } = await supabase
      .from('contacts')
      .select('first_name, last_name')
      .eq('id', contactId)
      .eq('user_id', userId)
      .single();

    if (!contact) {
      await sendMessage(chatId, '❌ Contact not found.');
      return;
    }

    const name = `${contact.first_name} ${contact.last_name || ''}`.trim();
    await sendMessage(
      chatId,
      `⚠️ Are you sure you want to delete <b>${escapeHtml(name)}</b>?\n\nThis cannot be undone.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, delete', callback_data: `cx:dy:${contactId}` },
              { text: '❌ Cancel', callback_data: 'cx:dn' },
            ],
          ],
        },
      }
    );
    return;
  }

  // cx:dy:<contactId> — confirm delete
  if (action.startsWith('dy:')) {
    const contactId = action.substring(3);
    const { data: contact } = await supabase
      .from('contacts')
      .select('first_name, last_name')
      .eq('id', contactId)
      .eq('user_id', userId)
      .single();

    if (!contact) {
      await sendMessage(chatId, '❌ Contact not found.');
      return;
    }

    const name = `${contact.first_name} ${contact.last_name || ''}`.trim();

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', contactId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting contact:', error);
      await sendMessage(chatId, '❌ Failed to delete contact. Please try again.');
      return;
    }

    await sendMessage(chatId, `✅ <b>${escapeHtml(name)}</b> has been deleted.`);
    return;
  }

  // cx:e:<fieldIndex>:<contactId> — edit a field
  if (action.startsWith('e:')) {
    const rest = action.substring(2);
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) return;

    const fieldIndex = parseInt(rest.substring(0, colonIdx), 10);
    const contactId = rest.substring(colonIdx + 1);

    if (fieldIndex < 0 || fieldIndex >= FIELD_FLOW.length) return;

    const field = FIELD_FLOW[fieldIndex];
    await setState(telegramUserId, `edit_existing_${field.state}`, { _editContactId: contactId });
    await sendMessage(chatId, `✏️ ${field.prompt}\n\nSend /cancel to cancel.`);
    return;
  }

  // cx:t:<contactId> — edit tags
  if (action.startsWith('t:')) {
    const contactId = action.substring(2);

    // Fetch current tags
    const { data: contact } = await supabase
      .from('contacts')
      .select('tags')
      .eq('id', contactId)
      .eq('user_id', userId)
      .single();

    if (!contact) {
      await sendMessage(chatId, '❌ Contact not found.');
      return;
    }

    const currentTags = Array.isArray(contact.tags) ? contact.tags as string[] : [];

    // Fetch user's tag list
    const { data: userTags } = await supabase
      .from('user_tags')
      .select('name')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (!userTags || userTags.length === 0) {
      await sendMessage(chatId, '🏷 No labels created yet. Create labels in the web app first, then assign them here.');
      return;
    }

    await setState(telegramUserId, 'select_tags', {
      _editContactId: contactId,
      _selectedTags: currentTags,
    });

    const keyboard = userTags.map((t) => {
      const name = t.name as string;
      const selected = currentTags.includes(name);
      return [{ text: `${selected ? '✅' : '⬜️'} ${name}`, callback_data: `tg:t:${name.substring(0, 55)}` }];
    });
    keyboard.push([{ text: '✅ Done', callback_data: 'tg:done' }]);

    await sendMessage(chatId,
      `🏷 <b>Select labels</b> (up to 3):\n\nCurrently selected: ${currentTags.length > 0 ? currentTags.join(', ') : 'none'}`,
      { reply_markup: { inline_keyboard: keyboard } }
    );
    return;
  }
}

export async function handleEditExistingContactText(
  chatId: number,
  telegramUserId: number,
  text: string,
  currentState: BotState
): Promise<boolean> {
  if (!currentState.state.startsWith('edit_existing_')) return false;

  const contactId = currentState.data._editContactId as string;
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId || !contactId) return false;

  // Determine which field from state name
  const fieldState = currentState.state.replace('edit_existing_', '');
  const fieldConfig = FIELD_FLOW.find((f) => f.state === fieldState);
  if (!fieldConfig) return false;

  // Build update object
  const column = FIELD_COLUMN_MAP[fieldConfig.field];
  if (!column) return false;

  let value: string;
  if (fieldConfig.field === 'telegramHandle') {
    value = text.startsWith('@') ? text : `@${text}`;
  } else {
    value = text.trim();
  }

  const { error } = await supabase
    .from('contacts')
    .update({ [column]: value })
    .eq('id', contactId)
    .eq('user_id', userId);

  if (error) {
    console.error('Error updating contact:', error);
    await sendMessage(chatId, '❌ Failed to update contact. Please try again.');
    await clearState(telegramUserId);
    return true;
  }

  await clearState(telegramUserId);
  await sendMessage(chatId, '✅ Updated!');
  await showContactDetail(chatId, userId, contactId);
  return true;
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
