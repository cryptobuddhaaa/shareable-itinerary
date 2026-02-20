// Bot state management & account linking

import { supabase } from './config';
import type { BotState } from './types';

export async function getState(telegramUserId: number): Promise<BotState> {
  const { data } = await supabase
    .from('telegram_bot_state')
    .select('state, data')
    .eq('telegram_user_id', telegramUserId)
    .single();

  return data || { state: 'idle', data: {} };
}

export async function setState(
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

export async function clearState(telegramUserId: number) {
  await setState(telegramUserId, 'idle', {});
}

export async function getLinkedUserId(telegramUserId: number): Promise<string | null> {
  const { data } = await supabase
    .from('telegram_links')
    .select('user_id')
    .eq('telegram_user_id', telegramUserId)
    .single();

  return data?.user_id || null;
}
