// /subscribe — Telegram Stars subscription flow

import { TELEGRAM_API } from '../_lib/config.js';
import { sendMessage, answerCallbackQuery } from '../_lib/telegram.js';
import { getLinkedUserId } from '../_lib/state.js';
import {
  PRICES,
  UPGRADE_PRICES,
  getSubscriptionStatus,
  activateSubscription,
  upgradeToAnnual,
} from '../../_lib/subscription.js';
import type { BillingPeriod } from '../../_lib/subscription.js';

// --- Telegram Bot API Helpers ---

async function answerPreCheckout(preCheckoutQueryId: string, ok: boolean, errorMessage?: string) {
  const body: Record<string, unknown> = {
    pre_checkout_query_id: preCheckoutQueryId,
    ok,
  };
  if (!ok && errorMessage) {
    body.error_message = errorMessage;
  }

  const resp = await fetch(`${TELEGRAM_API}/answerPreCheckoutQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.error('[Subscribe] answerPreCheckoutQuery failed:', resp.status, await resp.text());
  }
}

async function createInvoiceLink(
  title: string,
  description: string,
  payload: string,
  prices: Array<{ label: string; amount: number }>,
): Promise<string | null> {
  const resp = await fetch(`${TELEGRAM_API}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description,
      payload,
      currency: 'XTR',
      prices,
    }),
  });

  if (!resp.ok) {
    console.error('[Subscribe] createInvoiceLink failed:', resp.status, await resp.text());
    return null;
  }

  const data = await resp.json() as { ok: boolean; result?: string };
  return data.result || null;
}

// --- /subscribe command ---

export async function handleSubscribe(chatId: number, telegramUserId: number) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(chatId, '❌ Your account is not linked yet. Use /start to link.');
    return;
  }

  // Check current subscription status
  const subStatus = await getSubscriptionStatus(userId);

  if (subStatus.tier === 'premium') {
    // Monthly Stars subscriber → offer upgrade to annual
    if (subStatus.billingPeriod === 'monthly' && subStatus.paymentProvider === 'telegram_stars') {
      const daysLeft = subStatus.currentPeriodEnd
        ? Math.max(0, Math.ceil((new Date(subStatus.currentPeriodEnd).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
        : 0;

      await sendMessage(
        chatId,
        '<b>⬆️ Upgrade to Annual</b>\n\n' +
          `You're on the <b>Monthly</b> plan (${daysLeft} days remaining).\n\n` +
          `Upgrade to Annual for <b>${UPGRADE_PRICES.stars} Stars</b> (save ${PRICES.monthly.stars} Stars!).\n` +
          `Your subscription will extend <b>11 months</b> from your current expiry date.\n\n` +
          'Choose an option:',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: `Upgrade to Annual (${UPGRADE_PRICES.stars} ⭐)`, callback_data: 'sb:upgrade' }],
              [{ text: 'Stay on Monthly', callback_data: 'sb:back' }],
            ],
          },
        }
      );
      return;
    }

    // Already annual or different provider
    await sendMessage(
      chatId,
      '⭐ You already have <b>Convenu Premium</b>!\n\n' +
        'Manage your subscription in the web app under Profile → Subscription.'
    );
    return;
  }

  // Free user — show pricing
  await sendMessage(
    chatId,
    '<b>⭐ Convenu Premium</b>\n\n' +
      'Unlock the full power of Convenu:\n' +
      '• <b>Unlimited</b> contacts, itineraries & events\n' +
      '• <b>100</b> AI enrichments/month (vs 10 free)\n' +
      '• <b>Enhanced AI</b> (Sonnet model) for deeper profiles\n' +
      '• <b>Batch enrichment</b> — enrich up to 10 contacts at once\n' +
      '• <b>25 tags</b>, <b>10 templates</b>, unlimited notes\n' +
      '• <b>vCard export</b>\n\n' +
      '<b>Pricing:</b>\n' +
      `  💫 Monthly — <b>${PRICES.monthly.stars} Stars</b> ($${PRICES.monthly.usd}/mo)\n` +
      `  💫 Annual — <b>${PRICES.annual.stars} Stars</b> ($${PRICES.annual.usd}/yr — save $15!)\n\n` +
      'Choose your plan:',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: `Monthly (${PRICES.monthly.stars} ⭐)`, callback_data: 'sb:monthly' },
            { text: `Annual (${PRICES.annual.stars} ⭐)`, callback_data: 'sb:annual' },
          ],
          [
            { text: '💳 Pay with Card (Web App)', callback_data: 'sb:stripe' },
          ],
        ],
      },
    }
  );
}

// --- Callback handler for sb: prefix ---

export async function handleSubscribeCallback(
  chatId: number,
  telegramUserId: number,
  action: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(chatId, '❌ Your account is not linked.');
    return;
  }

  if (action === 'back') {
    // Re-show the subscribe menu
    await handleSubscribe(chatId, telegramUserId);
    return;
  }

  if (action === 'stripe') {
    // Direct user to web app for Stripe payment
    await sendMessage(
      chatId,
      '💳 To pay with card, open the web app and go to <b>Profile → Subscription</b>.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 Open App', web_app: { url: `${process.env.WEBAPP_URL || 'https://app.convenu.xyz'}` } }],
          ],
        },
      }
    );
    return;
  }

  // --- Upgrade from monthly to annual ---
  if (action === 'upgrade') {
    const subStatus = await getSubscriptionStatus(userId);
    if (subStatus.billingPeriod !== 'monthly' || subStatus.paymentProvider !== 'telegram_stars') {
      await sendMessage(chatId, '❌ Upgrade is only available for monthly Telegram Stars subscribers.');
      return;
    }

    const payload = JSON.stringify({
      userId,
      telegramUserId,
      period: 'annual' as BillingPeriod,
      upgrade: true,
    });

    const invoiceUrl = await createInvoiceLink(
      'Convenu Premium Upgrade (Annual)',
      'Upgrade from monthly to annual — 11 months added to your current subscription.',
      payload,
      [{ label: 'Upgrade to Annual', amount: UPGRADE_PRICES.stars }]
    );

    if (!invoiceUrl) {
      await sendMessage(chatId, '❌ Failed to create payment. Please try again.');
      return;
    }

    await sendMessage(
      chatId,
      `💫 <b>Upgrade to Annual</b>\n\nPrice: <b>${UPGRADE_PRICES.stars} Stars</b>\n\nTap below to pay:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `Pay ${UPGRADE_PRICES.stars} ⭐`, url: invoiceUrl }],
            [{ text: '« Back', callback_data: 'sb:back' }],
          ],
        },
      }
    );
    return;
  }

  if (action !== 'monthly' && action !== 'annual') {
    await sendMessage(chatId, '❌ Invalid option.');
    return;
  }

  const period = action as BillingPeriod;
  const price = PRICES[period];

  // Create an invoice link for Telegram Stars
  const title = `Convenu Premium (${period === 'annual' ? 'Annual' : 'Monthly'})`;
  const description = period === 'annual'
    ? `12 months of Convenu Premium — save $15! Unlimited contacts, 100 AI enrichments/month, enhanced AI, and more.`
    : `1 month of Convenu Premium — unlimited contacts, 100 AI enrichments/month, enhanced AI, and more.`;

  const payload = JSON.stringify({
    userId,
    telegramUserId,
    period,
  });

  const invoiceUrl = await createInvoiceLink(
    title,
    description,
    payload,
    [{ label: title, amount: price.stars }]
  );

  if (!invoiceUrl) {
    await sendMessage(chatId, '❌ Failed to create payment. Please try again later.');
    return;
  }

  await sendMessage(
    chatId,
    `💫 <b>${title}</b>\n\nPrice: <b>${price.stars} Stars</b> (~$${price.usd})\n\nTap below to pay:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: `Pay ${price.stars} ⭐`, url: invoiceUrl }],
          [{ text: '« Back', callback_data: 'sb:back' }],
        ],
      },
    }
  );
}

// --- Pre-checkout query handler ---

export async function handlePreCheckoutQuery(preCheckoutQuery: {
  id: string;
  from: { id: number };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}) {
  try {
    const payload = JSON.parse(preCheckoutQuery.invoice_payload) as {
      userId: string;
      telegramUserId: number;
      period: BillingPeriod;
      upgrade?: boolean;
    };

    // Validate the user is linked
    const userId = await getLinkedUserId(preCheckoutQuery.from.id);
    if (!userId || userId !== payload.userId) {
      await answerPreCheckout(preCheckoutQuery.id, false, 'Account not linked. Use /start first.');
      return;
    }

    // Validate amount matches expected price (upgrade or fresh)
    const expectedStars = payload.upgrade
      ? UPGRADE_PRICES.stars
      : PRICES[payload.period]?.stars;

    if (!expectedStars || preCheckoutQuery.total_amount !== expectedStars) {
      await answerPreCheckout(preCheckoutQuery.id, false, 'Price mismatch. Please try again.');
      return;
    }

    // All good — approve the checkout
    await answerPreCheckout(preCheckoutQuery.id, true);
  } catch (err) {
    console.error('[Subscribe] Pre-checkout error:', err);
    await answerPreCheckout(preCheckoutQuery.id, false, 'An error occurred. Please try again.');
  }
}

// --- Successful payment handler ---

export async function handleSuccessfulPayment(
  chatId: number,
  telegramUserId: number,
  payment: {
    currency: string;
    total_amount: number;
    invoice_payload: string;
    telegram_payment_charge_id: string;
    provider_payment_charge_id: string;
  }
) {
  try {
    const payload = JSON.parse(payment.invoice_payload) as {
      userId: string;
      telegramUserId: number;
      period: BillingPeriod;
      upgrade?: boolean;
    };

    const userId = await getLinkedUserId(telegramUserId);
    if (!userId) {
      await sendMessage(chatId, '❌ Payment received but account not linked. Contact support.');
      return;
    }

    if (payload.upgrade) {
      // Upgrade monthly → annual
      await upgradeToAnnual(userId, {
        telegramChargeId: payment.telegram_payment_charge_id,
      });

      await sendMessage(
        chatId,
        '🎉 <b>Upgraded to Annual!</b>\n\n' +
          'Your subscription has been extended by <b>11 months</b> from your current expiry date.\n\n' +
          'Enjoy your continued Premium access!'
      );

      console.log(`[Subscribe] Telegram Stars upgrade confirmed for user ${userId}, charge: ${payment.telegram_payment_charge_id}`);
      return;
    }

    // Fresh subscription
    await activateSubscription(userId, 'telegram_stars', payload.period, {
      telegramChargeId: payment.telegram_payment_charge_id,
    });

    const periodLabel = payload.period === 'annual' ? '12 months' : '1 month';
    await sendMessage(
      chatId,
      '🎉 <b>Welcome to Convenu Premium!</b>\n\n' +
        `Your subscription is active for <b>${periodLabel}</b>.\n\n` +
        '✅ Unlimited contacts, itineraries & events\n' +
        '✅ 100 AI enrichments/month\n' +
        '✅ Enhanced AI (Sonnet model)\n' +
        '✅ Batch enrichment\n' +
        '✅ 25 tags, 10 templates, unlimited notes\n\n' +
        'Enjoy! Use /enrich to try your expanded enrichment quota.'
    );

    console.log(`[Subscribe] Telegram Stars payment confirmed for user ${userId}, period: ${payload.period}, charge: ${payment.telegram_payment_charge_id}`);
  } catch (err) {
    console.error('[Subscribe] Payment processing error:', err);
    await sendMessage(chatId, '❌ Payment received but activation failed. Please contact support.');
  }
}
