// /enrich — AI-powered contact enrichment via Telegram bot

import { supabase } from '../_lib/config.js';
import { sendMessage, answerCallbackQuery } from '../_lib/telegram.js';
import { getLinkedUserId, getState, clearState } from '../_lib/state.js';
import { escapeHtml } from '../_lib/utils.js';
import {
  performEnrichment,
  getUsage,
} from '../../_lib/enrichment.js';
import type { EnrichmentData } from '../../_lib/enrichment.js';

function formatEnrichmentMessage(name: string, data: EnrichmentData, confidence: string | null): string {
  let msg = `✨ <b>AI Profile: ${escapeHtml(name)}</b>\n\n`;

  if (data.summary) {
    msg += `${escapeHtml(data.summary)}\n\n`;
  }

  if (data.roles && data.roles.length > 0) {
    msg += '<b>Roles:</b>\n';
    for (const role of data.roles) {
      const marker = role.current ? '🟢' : '⚪';
      msg += `  ${marker} ${escapeHtml(role.title)} at ${escapeHtml(role.organization)}\n`;
    }
    msg += '\n';
  }

  if (data.background && data.background.length > 0) {
    msg += '<b>Background:</b>\n';
    for (const item of data.background.slice(0, 3)) {
      msg += `  • ${escapeHtml(item)}\n`;
    }
    msg += '\n';
  }

  if (data.talkingPoints && data.talkingPoints.length > 0) {
    msg += '<b>Talking Points:</b>\n';
    for (const item of data.talkingPoints.slice(0, 3)) {
      msg += `  💬 ${escapeHtml(item)}\n`;
    }
    msg += '\n';
  }

  if (data.socialLinks && data.socialLinks.length > 0) {
    const links = data.socialLinks
      .map((l) => `${escapeHtml(l.platform)}${l.handle ? ': ' + escapeHtml(l.handle) : ''}`)
      .join(' | ');
    msg += `<b>Social:</b> ${links}\n\n`;
  }

  if (data.suggestedTags && data.suggestedTags.length > 0) {
    msg += `<b>Tags:</b> ${data.suggestedTags.map((t) => `#${escapeHtml(t)}`).join(' ')}\n\n`;
  }

  const confLabel = confidence === 'high' ? '🟢 High' : confidence === 'medium' ? '🟡 Medium' : '🔴 Low';
  msg += `<i>Confidence: ${confLabel}</i>`;

  return msg;
}

/**
 * /enrich — Enrich a contact by name or select from list
 * Usage: /enrich or /enrich John Smith, Company
 */
export async function handleEnrich(chatId: number, telegramUserId: number, args: string) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(chatId, '❌ Your account is not linked yet. Use /start to link.');
    return;
  }

  // Check usage
  const usage = await getUsage(userId);
  if (usage.used >= usage.limit) {
    const isPremium = usage.tier === 'premium';
    if (isPremium) {
      await sendMessage(
        chatId,
        `❌ You've used all ${usage.limit} enrichments this month (${usage.used}/${usage.limit}).`
      );
    } else {
      await sendMessage(
        chatId,
        `❌ You've used all ${usage.limit} free enrichments this month (${usage.used}/${usage.limit}).\n\n` +
          '⭐ <b>Upgrade to Premium</b> for 100 enrichments/month, enhanced AI, and more!',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '⭐ Subscribe to Premium', callback_data: 'sb:back' }],
            ],
          },
        }
      );
    }
    return;
  }

  if (args.trim()) {
    let contacts: { id: unknown; first_name: unknown; last_name: unknown; project_company: unknown; position: unknown }[] | null = null;
    let context: string | undefined;

    if (args.trim().startsWith('@')) {
      // Direct enrichment by Telegram handle: /enrich @username
      const handle = args.replace('@', '').trim();
      if (!handle) {
        await sendMessage(chatId, 'Usage: /enrich @username');
        return;
      }

      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, project_company, position')
        .eq('user_id', userId)
        .or(`telegram_handle.ilike.@${handle},telegram_handle.ilike.${handle}`)
        .limit(1);
      contacts = data;
    } else {
      // Direct enrichment by name: /enrich Name, Context
      const parts = args.split(',').map((s) => s.trim());
      const name = parts[0];
      context = parts.slice(1).join(', ') || undefined;

      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, project_company, position')
        .eq('user_id', userId)
        .or(`first_name.ilike.%${name.split(' ')[0]}%,last_name.ilike.%${name.split(' ').slice(1).join(' ') || name}%`)
        .limit(1);
      contacts = data;
    }

    if (contacts && contacts.length > 0) {
      const contact = contacts[0];
      await sendMessage(chatId, `✨ Enriching profile for <b>${escapeHtml(contact.first_name as string)} ${escapeHtml(contact.last_name as string)}</b>...`);

      try {
        const enrichment = await performEnrichment(
          userId,
          contact.id as string,
          `${contact.first_name} ${contact.last_name}`,
          context || [contact.project_company, contact.position].filter(Boolean).join(', ') || undefined
        );

        const msg = formatEnrichmentMessage(
          `${contact.first_name} ${contact.last_name}`,
          enrichment.enrichmentData,
          enrichment.confidence
        );

        await sendMessage(chatId, msg, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Regenerate', callback_data: `en:${contact.id}` }],
            ],
          },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(chatId, `❌ Enrichment failed: ${escapeHtml(errMsg)}`);
      }
    } else {
      // No matching contact found
      const query = args.trim().startsWith('@') ? `@${args.replace('@', '').trim()}` : args.trim();
      await sendMessage(chatId, `⚠️ No matching contact found for "${escapeHtml(query)}". Use /newcontact to add them first, then try /enrich again.`);
    }
  } else {
    // Check if there's a last-created contact to auto-enrich
    const botState = await getState(telegramUserId);
    const lastContactId = botState.data?._lastContactId as string | undefined;

    if (lastContactId) {
      // Clear the stored ID so subsequent /enrich calls show the picker
      await clearState(telegramUserId);

      const { data: lastContact } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, project_company, position')
        .eq('id', lastContactId)
        .eq('user_id', userId)
        .single();

      if (lastContact) {
        const name = `${lastContact.first_name} ${lastContact.last_name}`;
        const context = [lastContact.project_company, lastContact.position].filter(Boolean).join(', ') || undefined;

        await sendMessage(chatId, `✨ Enriching profile for <b>${escapeHtml(name)}</b>...`);

        try {
          const enrichment = await performEnrichment(userId, lastContact.id as string, name, context);
          const msg = formatEnrichmentMessage(name, enrichment.enrichmentData, enrichment.confidence);
          const updatedUsage = await getUsage(userId);

          await sendMessage(chatId, msg + `\n\n<i>${updatedUsage.used}/${updatedUsage.limit} enrichments used this month</i>`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Regenerate', callback_data: `en:${lastContact.id}` }],
              ],
            },
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          await sendMessage(chatId, `❌ Enrichment failed: ${escapeHtml(errMsg)}`);
        }
        return;
      }
    }

    // Show recent contacts to pick from
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, project_company')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(8);

    if (!contacts || contacts.length === 0) {
      await sendMessage(chatId, '📭 No contacts found. Add contacts first with /newcontact.');
      return;
    }

    const keyboard = contacts.map((c) => [{
      text: `${c.first_name} ${c.last_name}${c.project_company ? ` (${c.project_company})` : ''}`,
      callback_data: `en:${c.id}`,
    }]);

    await sendMessage(
      chatId,
      `✨ <b>AI Enrichment</b> (${usage.used}/${usage.limit} used)\n\nSelect a contact to enrich:`,
      { reply_markup: { inline_keyboard: keyboard } }
    );
  }
}

/**
 * Handle en: callback — either selecting a contact to enrich or regenerating
 */
export async function handleEnrichCallback(
  chatId: number,
  telegramUserId: number,
  contactId: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(chatId, '❌ Your account is not linked.');
    return;
  }

  // Fetch contact
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, project_company, position')
    .eq('id', contactId)
    .eq('user_id', userId)
    .single();

  if (!contact) {
    await sendMessage(chatId, '❌ Contact not found.');
    return;
  }

  const name = `${contact.first_name} ${contact.last_name}`;
  const context = [contact.project_company, contact.position].filter(Boolean).join(', ') || undefined;

  await sendMessage(chatId, `✨ Enriching profile for <b>${escapeHtml(name)}</b>...`);

  try {
    const enrichment = await performEnrichment(userId, contact.id as string, name, context);
    const msg = formatEnrichmentMessage(name, enrichment.enrichmentData, enrichment.confidence);

    const usage = await getUsage(userId);
    await sendMessage(chatId, msg + `\n\n<i>${usage.used}/${usage.limit} enrichments used this month</i>`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Regenerate', callback_data: `en:${contact.id}` }],
        ],
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    if (errMsg.includes('LIMIT_REACHED')) {
      await sendMessage(
        chatId,
        '❌ Monthly enrichment limit reached.\n\n⭐ Upgrade to Premium for 100 enrichments/month!',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '⭐ Subscribe to Premium', callback_data: 'sb:back' }],
            ],
          },
        }
      );
    } else {
      await sendMessage(chatId, `❌ Enrichment failed: ${escapeHtml(errMsg)}`);
    }
  }
}
