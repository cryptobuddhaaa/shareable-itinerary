/**
 * Admin dashboard API handler.
 * Routed through api/profile/index.ts via ?action=admin-* to avoid
 * consuming an additional Vercel Hobby plan function slot.
 *
 * All actions require admin_users membership.
 *
 * Actions:
 *   admin-check       — Check if current user is an admin
 *   admin-stats       — Overview statistics (counts, DAU, MAU, etc.)
 *   admin-users       — Paginated user list with search
 *   admin-user-detail — Full detail for a single user
 *   admin-handshakes  — Handshake list with filters
 *   admin-events      — Event analytics (top events by handshake count)
 *   admin-trust-dist  — Trust score distribution histogram
 *   admin-signups     — Signup trend data (daily, by method)
 *   admin-handshake-funnel — Handshake status funnel counts
 *   admin-reset-enrichment — Reset a user's monthly enrichment usage to 0
 *   admin-upgrade-user     — Upgrade a user to premium (admin grant)
 *   admin-downgrade-user   — Downgrade a user to free tier
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from './admin-auth.js';
import { activateSubscription, downgradeSubscription } from './subscription.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export async function handleAdminAction(
  action: string,
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // admin-check can use a lighter auth check
  if (action === 'admin-check') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.status(200).json({ isAdmin: true, role: admin.role });
    return;
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  switch (action) {
    case 'admin-stats':
      await handleStats(res);
      return;
    case 'admin-users':
      await handleUsers(req, res);
      return;
    case 'admin-user-detail':
      await handleUserDetail(req, res);
      return;
    case 'admin-handshakes':
      await handleHandshakes(req, res);
      return;
    case 'admin-events':
      await handleEvents(req, res);
      return;
    case 'admin-trust-dist':
      await handleTrustDistribution(res);
      return;
    case 'admin-signups':
      await handleSignups(req, res);
      return;
    case 'admin-handshake-funnel':
      await handleHandshakeFunnel(req, res);
      return;
    case 'admin-reset-enrichment':
      await handleResetEnrichment(req, res);
      return;
    case 'admin-upgrade-user':
      await handleUpgradeUser(admin, req, res);
      return;
    case 'admin-downgrade-user':
      await handleDowngradeUser(req, res);
      return;
    default:
      res.status(400).json({ error: `Unknown admin action: ${action}` });
  }
}

// ─── admin-stats ──────────────────────────────────────────────────────────────

async function handleStats(res: VercelResponse) {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Run all counts in parallel
    const [
      totalUsersRes,
      dauRes,
      mauRes,
      wauRes,
      totalHandshakesRes,
      mintedHandshakesRes,
      pendingHandshakesRes,
      totalWalletsRes,
      verifiedWalletsRes,
      totalContactsRes,
      totalItinerariesRes,
      totalPointsRes,
      telegramLinksRes,
      subscriptionsRes,
    ] = await Promise.all([
      // Total registered users
      supabase.from('trust_scores').select('*', { count: 'exact', head: true }),
      // DAU: users with trust_scores updated today (proxy for activity)
      supabase.from('trust_scores').select('*', { count: 'exact', head: true })
        .gte('updated_at', todayStart),
      // MAU: users with trust_scores updated in last 30 days
      supabase.from('trust_scores').select('*', { count: 'exact', head: true })
        .gte('updated_at', thirtyDaysAgo),
      // WAU: users active in last 7 days
      supabase.from('trust_scores').select('*', { count: 'exact', head: true })
        .gte('updated_at', sevenDaysAgo),
      // Total handshakes
      supabase.from('handshakes').select('*', { count: 'exact', head: true }),
      // Minted handshakes
      supabase.from('handshakes').select('*', { count: 'exact', head: true })
        .eq('status', 'minted'),
      // Pending handshakes
      supabase.from('handshakes').select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      // Total wallets
      supabase.from('user_wallets').select('*', { count: 'exact', head: true }),
      // Verified wallets
      supabase.from('user_wallets').select('*', { count: 'exact', head: true })
        .not('verified_at', 'is', null),
      // Total contacts
      supabase.from('contacts').select('*', { count: 'exact', head: true }),
      // Total itineraries
      supabase.from('itineraries').select('*', { count: 'exact', head: true }),
      // Total points awarded
      supabase.from('user_points').select('points'),
      // Telegram linked accounts
      supabase.from('telegram_links').select('*', { count: 'exact', head: true }),
      // Subscription tiers
      supabase.from('subscriptions').select('tier'),
    ]);

    // Sum total points
    const totalPoints = (totalPointsRes.data || []).reduce(
      (sum: number, row: { points: number }) => sum + (row.points || 0), 0
    );

    // Count subscription tiers
    const tierCounts: Record<string, number> = { free: 0, premium: 0, pro: 0 };
    for (const row of (subscriptionsRes.data || [])) {
      const tier = (row as { tier: string }).tier;
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    }

    res.status(200).json({
      totalUsers: totalUsersRes.count || 0,
      dau: dauRes.count || 0,
      wau: wauRes.count || 0,
      mau: mauRes.count || 0,
      stickiness: (mauRes.count || 0) > 0
        ? Math.round(((dauRes.count || 0) / (mauRes.count || 1)) * 100)
        : 0,
      totalHandshakes: totalHandshakesRes.count || 0,
      mintedHandshakes: mintedHandshakesRes.count || 0,
      pendingHandshakes: pendingHandshakesRes.count || 0,
      totalWallets: totalWalletsRes.count || 0,
      verifiedWallets: verifiedWalletsRes.count || 0,
      walletVerificationRate: (totalWalletsRes.count || 0) > 0
        ? Math.round(((verifiedWalletsRes.count || 0) / (totalWalletsRes.count || 1)) * 100)
        : 0,
      totalContacts: totalContactsRes.count || 0,
      totalItineraries: totalItinerariesRes.count || 0,
      totalPoints,
      telegramLinkedUsers: telegramLinksRes.count || 0,
      subscriptionTiers: tierCounts,
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
}

// ─── admin-users ──────────────────────────────────────────────────────────────

async function handleUsers(req: VercelRequest, res: VercelResponse) {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const search = String(req.query.search || '').trim();
    const sortBy = String(req.query.sortBy || 'created_at');
    const sortDir = String(req.query.sortDir || 'desc') === 'asc' ? true : false;
    const offset = (page - 1) * limit;

    // Fetch user profiles with trust scores joined
    // Using service role key bypasses RLS
    let query = supabase
      .from('user_profiles')
      .select(`
        user_id,
        first_name,
        last_name,
        company,
        position,
        avatar_url,
        created_at,
        updated_at
      `, { count: 'exact' });

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,company.ilike.%${search}%`
      );
    }

    const validSortColumns = ['created_at', 'updated_at', 'first_name', 'last_name'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';

    const { data: profiles, count, error } = await query
      .order(sortColumn, { ascending: sortDir })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Admin users query error:', error);
      return res.status(500).json({ error: 'Failed to load users' });
    }

    // Fetch trust scores for these users
    const userIds = (profiles || []).map((p: { user_id: string }) => p.user_id);
    const { data: trustScores } = userIds.length > 0
      ? await supabase
          .from('trust_scores')
          .select('user_id, trust_score, total_handshakes, wallet_connected, x_verified, updated_at')
          .in('user_id', userIds)
      : { data: [] };

    // Fetch telegram links for these users
    const { data: tgLinks } = userIds.length > 0
      ? await supabase
          .from('telegram_links')
          .select('user_id, telegram_username')
          .in('user_id', userIds)
      : { data: [] };

    // Fetch handshake counts per user
    const { data: handshakeCounts } = userIds.length > 0
      ? await supabase
          .from('handshakes')
          .select('initiator_user_id, receiver_user_id')
          .or(
            userIds.map(id => `initiator_user_id.eq.${id}`).join(',') +
            ',' +
            userIds.map(id => `receiver_user_id.eq.${id}`).join(',')
          )
      : { data: [] };

    // Build per-user handshake counts
    const hsCountMap: Record<string, number> = {};
    for (const hs of (handshakeCounts || [])) {
      const row = hs as { initiator_user_id: string; receiver_user_id: string | null };
      if (row.initiator_user_id && userIds.includes(row.initiator_user_id)) {
        hsCountMap[row.initiator_user_id] = (hsCountMap[row.initiator_user_id] || 0) + 1;
      }
      if (row.receiver_user_id && userIds.includes(row.receiver_user_id)) {
        hsCountMap[row.receiver_user_id] = (hsCountMap[row.receiver_user_id] || 0) + 1;
      }
    }

    // Merge data
    const trustMap = new Map(
      (trustScores || []).map((t: Record<string, unknown>) => [t.user_id as string, t])
    );
    const tgMap = new Map(
      (tgLinks || []).map((t: { user_id: string; telegram_username: string | null }) => [t.user_id, t.telegram_username])
    );

    const users = (profiles || []).map((p: Record<string, unknown>) => {
      const ts = trustMap.get(p.user_id as string) as Record<string, unknown> | undefined;
      return {
        userId: p.user_id,
        firstName: p.first_name,
        lastName: p.last_name,
        company: p.company,
        position: p.position,
        avatarUrl: p.avatar_url,
        createdAt: p.created_at,
        trustScore: ts?.trust_score || 0,
        totalHandshakes: hsCountMap[p.user_id as string] || 0,
        walletConnected: ts?.wallet_connected || false,
        xVerified: ts?.x_verified || false,
        telegramUsername: tgMap.get(p.user_id as string) || null,
        lastActive: ts?.updated_at || p.updated_at,
      };
    });

    res.status(200).json({
      users,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
}

// ─── admin-user-detail ────────────────────────────────────────────────────────

async function handleUserDetail(req: VercelRequest, res: VercelResponse) {
  const userId = String(req.query.userId || '');
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return res.status(400).json({ error: 'Valid userId required' });
  }

  try {
    const currentMonth = new Date().toISOString().substring(0, 7);

    const [profileRes, trustRes, walletsRes, handshakesRes, pointsRes, tgLinkRes, contactsRes, subscriptionRes, enrichmentUsageRes] = await Promise.all([
      supabase.from('user_profiles').select('*').eq('user_id', userId).single(),
      supabase.from('trust_scores').select('*').eq('user_id', userId).single(),
      supabase.from('user_wallets').select('*').eq('user_id', userId),
      supabase.from('handshakes').select('*')
        .or(`initiator_user_id.eq.${userId},receiver_user_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('user_points').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('telegram_links').select('*').eq('user_id', userId).single(),
      supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('subscriptions').select('*').eq('user_id', userId).single(),
      supabase.from('enrichment_usage').select('usage_count, month').eq('user_id', userId).eq('month', currentMonth).maybeSingle(),
    ]);

    const totalPoints = (pointsRes.data || []).reduce(
      (sum: number, row: { points: number }) => sum + (row.points || 0), 0
    );

    res.status(200).json({
      profile: profileRes.data || null,
      trustScore: trustRes.data || null,
      wallets: walletsRes.data || [],
      handshakes: handshakesRes.data || [],
      recentPoints: pointsRes.data || [],
      totalPoints,
      telegramLink: tgLinkRes.data || null,
      contactCount: contactsRes.count || 0,
      subscription: subscriptionRes.data || null,
      enrichmentUsage: {
        used: (enrichmentUsageRes.data as { usage_count: number } | null)?.usage_count ?? 0,
        limit: subscriptionRes.data && (subscriptionRes.data as Record<string, unknown>).tier === 'premium' ? 100 : 10,
        month: currentMonth,
      },
    });
  } catch (error) {
    console.error('Admin user detail error:', error);
    res.status(500).json({ error: 'Failed to load user detail' });
  }
}

// ─── admin-handshakes ─────────────────────────────────────────────────────────

async function handleHandshakes(req: VercelRequest, res: VercelResponse) {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const status = String(req.query.status || '').trim();
    const eventTitle = String(req.query.eventTitle || '').trim();
    const userId = String(req.query.userId || '').trim();
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    const offset = (page - 1) * limit;

    let query = supabase
      .from('handshakes')
      .select('*', { count: 'exact' });

    if (status && ['pending', 'claimed', 'matched', 'minted', 'expired'].includes(status)) {
      query = query.eq('status', status);
    }
    if (eventTitle) {
      query = query.ilike('event_title', `%${eventTitle}%`);
    }
    if (userId && /^[0-9a-f-]{36}$/i.test(userId)) {
      query = query.or(`initiator_user_id.eq.${userId},receiver_user_id.eq.${userId}`);
    }
    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }
    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    const { data: handshakes, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Admin handshakes query error:', error);
      return res.status(500).json({ error: 'Failed to load handshakes' });
    }

    res.status(200).json({
      handshakes: handshakes || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (error) {
    console.error('Admin handshakes error:', error);
    res.status(500).json({ error: 'Failed to load handshakes' });
  }
}

// ─── admin-events ─────────────────────────────────────────────────────────────

async function handleEvents(req: VercelRequest, res: VercelResponse) {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));

    // Get all handshakes that have event_title set, grouped by event
    const { data: handshakes } = await supabase
      .from('handshakes')
      .select('event_title, event_date, status')
      .not('event_title', 'is', null);

    // Aggregate by event title
    const eventMap = new Map<string, {
      eventTitle: string;
      eventDate: string | null;
      totalHandshakes: number;
      mintedHandshakes: number;
      pendingHandshakes: number;
    }>();

    for (const hs of (handshakes || [])) {
      const row = hs as { event_title: string; event_date: string | null; status: string };
      if (!row.event_title) continue;
      const key = row.event_title;
      if (!eventMap.has(key)) {
        eventMap.set(key, {
          eventTitle: row.event_title,
          eventDate: row.event_date,
          totalHandshakes: 0,
          mintedHandshakes: 0,
          pendingHandshakes: 0,
        });
      }
      const entry = eventMap.get(key)!;
      entry.totalHandshakes++;
      if (row.status === 'minted') entry.mintedHandshakes++;
      if (row.status === 'pending') entry.pendingHandshakes++;
    }

    // Sort by total handshakes descending
    const events = Array.from(eventMap.values())
      .sort((a, b) => b.totalHandshakes - a.totalHandshakes)
      .slice(0, limit);

    res.status(200).json({ events, total: eventMap.size });
  } catch (error) {
    console.error('Admin events error:', error);
    res.status(500).json({ error: 'Failed to load events' });
  }
}

// ─── admin-trust-dist ─────────────────────────────────────────────────────────

async function handleTrustDistribution(res: VercelResponse) {
  try {
    const { data: scores } = await supabase
      .from('trust_scores')
      .select('trust_score, score_handshakes, score_wallet, score_socials, score_events, score_community');

    // Build histogram buckets: 0-9, 10-19, 20-29, ..., 90-100
    const buckets = Array(10).fill(0) as number[];
    const categoryTotals = {
      handshakes: 0, wallet: 0, socials: 0, events: 0, community: 0,
    };
    let totalUsers = 0;
    let totalScore = 0;

    for (const row of (scores || [])) {
      const r = row as Record<string, number>;
      const score = r.trust_score || 0;
      const bucket = Math.min(9, Math.floor(score / 10));
      buckets[bucket]++;
      totalUsers++;
      totalScore += score;
      categoryTotals.handshakes += r.score_handshakes || 0;
      categoryTotals.wallet += r.score_wallet || 0;
      categoryTotals.socials += r.score_socials || 0;
      categoryTotals.events += r.score_events || 0;
      categoryTotals.community += r.score_community || 0;
    }

    const avgScore = totalUsers > 0 ? Math.round(totalScore / totalUsers) : 0;
    const avgCategories = totalUsers > 0 ? {
      handshakes: Math.round(categoryTotals.handshakes / totalUsers * 10) / 10,
      wallet: Math.round(categoryTotals.wallet / totalUsers * 10) / 10,
      socials: Math.round(categoryTotals.socials / totalUsers * 10) / 10,
      events: Math.round(categoryTotals.events / totalUsers * 10) / 10,
      community: Math.round(categoryTotals.community / totalUsers * 10) / 10,
    } : { handshakes: 0, wallet: 0, socials: 0, events: 0, community: 0 };

    res.status(200).json({
      buckets: buckets.map((count, i) => ({
        label: i === 9 ? '90-100' : `${i * 10}-${i * 10 + 9}`,
        count,
      })),
      avgScore,
      avgCategories,
      totalUsers,
    });
  } catch (error) {
    console.error('Admin trust distribution error:', error);
    res.status(500).json({ error: 'Failed to load trust distribution' });
  }
}

// ─── admin-signups ────────────────────────────────────────────────────────────

async function handleSignups(req: VercelRequest, res: VercelResponse) {
  try {
    const days = Math.min(90, Math.max(7, parseInt(String(req.query.days || '30'), 10)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    // Aggregate by day
    const dailyMap = new Map<string, number>();
    for (const row of (profiles || [])) {
      const date = (row as { created_at: string }).created_at.split('T')[0];
      dailyMap.set(date, (dailyMap.get(date) || 0) + 1);
    }

    // Fill in missing days with 0
    const result: { date: string; count: number }[] = [];
    const start = new Date(since);
    const end = new Date();
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      result.push({ date: dateStr, count: dailyMap.get(dateStr) || 0 });
    }

    // Also get Telegram-linked signup counts
    const { data: tgLinks } = await supabase
      .from('telegram_links')
      .select('linked_at')
      .gte('linked_at', since);

    const tgDailyMap = new Map<string, number>();
    for (const row of (tgLinks || [])) {
      const date = ((row as { linked_at: string }).linked_at || '').split('T')[0];
      if (date) tgDailyMap.set(date, (tgDailyMap.get(date) || 0) + 1);
    }

    const tgResult: { date: string; count: number }[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      tgResult.push({ date: dateStr, count: tgDailyMap.get(dateStr) || 0 });
    }

    res.status(200).json({
      signups: result,
      telegramLinks: tgResult,
      totalInPeriod: (profiles || []).length,
      telegramInPeriod: (tgLinks || []).length,
    });
  } catch (error) {
    console.error('Admin signups error:', error);
    res.status(500).json({ error: 'Failed to load signup data' });
  }
}

// ─── admin-reset-enrichment ──────────────────────────────────────────────────

async function handleResetEnrichment(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = String(req.body?.userId || '');
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return res.status(400).json({ error: 'Valid userId required' });
  }

  try {
    const month = new Date().toISOString().substring(0, 7);

    const { error } = await supabase
      .from('enrichment_usage')
      .update({ usage_count: 0 })
      .eq('user_id', userId)
      .eq('month', month);

    if (error) {
      console.error('Admin reset enrichment error:', error);
      return res.status(500).json({ error: 'Failed to reset enrichment usage' });
    }

    console.log(`[Admin] Reset enrichment usage for user ${userId} (month: ${month})`);
    res.status(200).json({ success: true, month });
  } catch (error) {
    console.error('Admin reset enrichment error:', error);
    res.status(500).json({ error: 'Failed to reset enrichment usage' });
  }
}

// ─── admin-handshake-funnel ───────────────────────────────────────────────────

async function handleHandshakeFunnel(req: VercelRequest, res: VercelResponse) {
  try {
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    const eventTitle = String(req.query.eventTitle || '').trim();

    let query = supabase.from('handshakes').select('status, created_at');

    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);
    if (eventTitle) query = query.ilike('event_title', `%${eventTitle}%`);

    const { data: handshakes } = await query;

    const funnel = {
      initiated: 0,  // all statuses count as initiated
      claimed: 0,
      matched: 0,
      minted: 0,
      expired: 0,
      pending: 0,
    };

    for (const hs of (handshakes || [])) {
      const status = (hs as { status: string }).status;
      funnel.initiated++;
      // Cumulative funnel: minted implies it went through claimed + matched
      if (status === 'claimed' || status === 'matched' || status === 'minted') funnel.claimed++;
      if (status === 'matched' || status === 'minted') funnel.matched++;
      if (status === 'minted') funnel.minted++;
      if (status === 'expired') funnel.expired++;
      if (status === 'pending') funnel.pending++;
    }

    res.status(200).json({ funnel });
  } catch (error) {
    console.error('Admin handshake funnel error:', error);
    res.status(500).json({ error: 'Failed to load handshake funnel' });
  }
}

// ─── admin-upgrade-user ──────────────────────────────────────────────────────

async function handleUpgradeUser(
  admin: { id: string; role: string },
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = String(req.body?.userId || '');
  const reason = String(req.body?.reason || 'Admin grant').slice(0, 500);

  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return res.status(400).json({ error: 'Valid userId required' });
  }

  try {
    await activateSubscription(userId, 'admin', 'monthly', {
      adminGrantedBy: admin.id,
      adminGrantReason: reason,
    });

    console.log(`[Admin] ${admin.id} upgraded user ${userId} to premium. Reason: ${reason}`);
    res.status(200).json({ success: true, tier: 'premium', reason });
  } catch (error) {
    console.error('Admin upgrade user error:', error);
    res.status(500).json({ error: 'Failed to upgrade user' });
  }
}

// ─── admin-downgrade-user ────────────────────────────────────────────────────

async function handleDowngradeUser(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = String(req.body?.userId || '');
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return res.status(400).json({ error: 'Valid userId required' });
  }

  try {
    await downgradeSubscription(userId);

    console.log(`[Admin] Downgraded user ${userId} to free`);
    res.status(200).json({ success: true, tier: 'free' });
  } catch (error) {
    console.error('Admin downgrade user error:', error);
    res.status(500).json({ error: 'Failed to downgrade user' });
  }
}
