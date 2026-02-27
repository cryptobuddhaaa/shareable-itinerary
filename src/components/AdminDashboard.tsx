/**
 * AdminDashboard — Master admin panel for internal team use.
 * Accessible only to users in the admin_users table.
 *
 * Sections:
 *   Overview  — Key metrics cards (users, DAU/MAU, handshakes, wallets, etc.)
 *   Users     — Searchable, paginated user table with drill-down
 *   Handshakes — Filterable handshake list + funnel visualization
 *   Events    — Top events by handshake count
 *   Trust     — Trust score distribution histogram + averages
 *   Signups   — Daily signup trend chart
 */

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../lib/authFetch';

const API_BASE = '/api/profile';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  totalUsers: number;
  dau: number;
  wau: number;
  mau: number;
  stickiness: number;
  totalHandshakes: number;
  mintedHandshakes: number;
  pendingHandshakes: number;
  totalWallets: number;
  verifiedWallets: number;
  walletVerificationRate: number;
  totalContacts: number;
  totalItineraries: number;
  totalPoints: number;
  telegramLinkedUsers: number;
  subscriptionTiers: Record<string, number>;
}

interface UserRow {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  avatarUrl: string | null;
  createdAt: string;
  trustScore: number;
  totalHandshakes: number;
  walletConnected: boolean;
  xVerified: boolean;
  telegramUsername: string | null;
  lastActive: string;
}

interface HandshakeRow {
  id: string;
  initiator_user_id: string;
  receiver_user_id: string | null;
  receiver_identifier: string;
  event_title: string | null;
  event_date: string | null;
  status: string;
  points_awarded: number;
  initiator_nft_address: string | null;
  receiver_nft_address: string | null;
  created_at: string;
}

interface EventRow {
  eventTitle: string;
  eventDate: string | null;
  totalHandshakes: number;
  mintedHandshakes: number;
  pendingHandshakes: number;
}

interface TrustBucket {
  label: string;
  count: number;
}

interface TrustDist {
  buckets: TrustBucket[];
  avgScore: number;
  avgCategories: Record<string, number>;
  totalUsers: number;
}

interface SignupDay {
  date: string;
  count: number;
}

interface FunnelData {
  initiated: number;
  claimed: number;
  matched: number;
  minted: number;
  expired: number;
  pending: number;
}

interface UserDetail {
  profile: Record<string, unknown> | null;
  trustScore: Record<string, unknown> | null;
  wallets: Record<string, unknown>[];
  handshakes: Record<string, unknown>[];
  recentPoints: Record<string, unknown>[];
  totalPoints: number;
  telegramLink: Record<string, unknown> | null;
  contactCount: number;
  subscription: Record<string, unknown> | null;
  enrichmentUsage: { used: number; limit: number; month: string };
}

type AdminTab = 'overview' | 'users' | 'handshakes' | 'events' | 'trust' | 'signups';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function adminFetch<T>(action: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ action, ...params });
  const resp = await authFetch(`${API_BASE}?${qs.toString()}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((err as { error?: string }).error || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return id.slice(0, 6) + '...' + id.slice(-4);
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1 font-mono">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-900/40 text-yellow-300',
    claimed: 'bg-blue-900/40 text-blue-300',
    matched: 'bg-purple-900/40 text-purple-300',
    minted: 'bg-green-900/40 text-green-300',
    expired: 'bg-red-900/40 text-red-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-slate-700 text-slate-300'}`}>
      {status}
    </span>
  );
}

// ─── Overview Section ─────────────────────────────────────────────────────────

function OverviewSection({ stats }: { stats: Stats | null }) {
  if (!stats) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Platform Overview</h3>

      {/* User metrics */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 mb-3">Users</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Total Users" value={stats.totalUsers} />
          <StatCard label="DAU" value={stats.dau} sub="Active today" />
          <StatCard label="WAU" value={stats.wau} sub="Last 7 days" />
          <StatCard label="MAU" value={stats.mau} sub="Last 30 days" />
          <StatCard label="Stickiness" value={`${stats.stickiness}%`} sub="DAU / MAU" />
        </div>
      </div>

      {/* Handshake metrics */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 mb-3">Handshakes</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Total" value={stats.totalHandshakes} />
          <StatCard label="Minted" value={stats.mintedHandshakes} sub="Completed on-chain" />
          <StatCard label="Pending" value={stats.pendingHandshakes} sub="Awaiting claim" />
        </div>
      </div>

      {/* Wallet + Web3 metrics */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 mb-3">Web3 & Wallets</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Wallets" value={stats.totalWallets} />
          <StatCard label="Verified" value={stats.verifiedWallets} sub={`${stats.walletVerificationRate}% rate`} />
          <StatCard label="Total Points" value={stats.totalPoints.toLocaleString()} />
        </div>
      </div>

      {/* Engagement metrics */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 mb-3">Engagement</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Contacts" value={stats.totalContacts} />
          <StatCard label="Itineraries" value={stats.totalItineraries} />
          <StatCard label="Telegram" value={stats.telegramLinkedUsers} sub="Linked accounts" />
          <StatCard
            label="Subscriptions"
            value={stats.subscriptionTiers.premium || 0}
            sub={`${stats.subscriptionTiers.free || 0} free / ${stats.subscriptionTiers.premium || 0} premium`}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Users Section ────────────────────────────────────────────────────────────

function UsersSection({ onSelectUser }: { onSelectUser: (userId: string) => void }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const limit = 25;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminFetch<{ users: UserRow[]; total: number }>('admin-users', {
        page: String(page), limit: String(limit), search,
      });
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
    setLoading(false);
  }, [page, search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Users ({total})</h3>
        <form
          onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(1); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or company..."
            className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
          />
          <button
            type="submit"
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-500"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
              className="px-3 py-1.5 bg-slate-700 text-slate-300 text-sm rounded-md hover:bg-slate-600"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase border-b border-slate-700">
                <tr>
                  <th className="py-3 px-3">User</th>
                  <th className="py-3 px-3">Company</th>
                  <th className="py-3 px-3">Trust</th>
                  <th className="py-3 px-3">Handshakes</th>
                  <th className="py-3 px-3">Links</th>
                  <th className="py-3 px-3">Joined</th>
                  <th className="py-3 px-3">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {users.map((u) => (
                  <tr
                    key={u.userId}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                    onClick={() => onSelectUser(u.userId)}
                  >
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt="" className="w-7 h-7 rounded-full" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center text-xs text-slate-300">
                            {(u.firstName || '?')[0]}
                          </div>
                        )}
                        <div>
                          <p className="text-white font-medium">
                            {u.firstName || ''} {u.lastName || ''}
                            {!u.firstName && !u.lastName && <span className="text-slate-500">Unnamed</span>}
                          </p>
                          {u.telegramUsername && (
                            <p className="text-xs text-slate-500">@{u.telegramUsername}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-300">{u.company || '—'}</td>
                    <td className="py-3 px-3">
                      <span className={`font-mono font-bold ${
                        u.trustScore >= 60 ? 'text-yellow-300' :
                        u.trustScore >= 40 ? 'text-purple-300' :
                        u.trustScore >= 25 ? 'text-green-300' :
                        u.trustScore >= 10 ? 'text-blue-300' : 'text-slate-400'
                      }`}>{u.trustScore}</span>
                    </td>
                    <td className="py-3 px-3 text-slate-300 font-mono">{u.totalHandshakes}</td>
                    <td className="py-3 px-3">
                      <div className="flex gap-1">
                        {u.walletConnected && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-emerald-900/40 text-emerald-300" title="Wallet verified">W</span>
                        )}
                        {u.xVerified && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-sky-900/40 text-sky-300" title="X verified">X</span>
                        )}
                        {u.telegramUsername && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-blue-900/40 text-blue-300" title="Telegram linked">TG</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-xs">{formatDate(u.createdAt)}</td>
                    <td className="py-3 px-3 text-slate-400 text-xs">{formatDate(u.lastActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-500">
                Page {page} of {totalPages} ({total} users)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 text-sm bg-slate-700 text-slate-300 rounded disabled:opacity-40 hover:bg-slate-600"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 text-sm bg-slate-700 text-slate-300 rounded disabled:opacity-40 hover:bg-slate-600"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── User Detail Panel ────────────────────────────────────────────────────────

function UserDetailPanel({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resettingEnrichment, setResettingEnrichment] = useState(false);
  const [changingTier, setChangingTier] = useState(false);
  const [grantReason, setGrantReason] = useState('');

  useEffect(() => {
    setLoading(true);
    adminFetch<UserDetail>('admin-user-detail', { userId })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId]);

  const handleResetEnrichment = async () => {
    if (!confirm('Reset this user\'s enrichment usage to 0 for the current month?')) return;
    setResettingEnrichment(true);
    try {
      const resp = await authFetch(`${API_BASE}?action=admin-reset-enrichment`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error((err as { error?: string }).error || `HTTP ${resp.status}`);
      }
      // Update local state
      setData(prev => prev ? {
        ...prev,
        enrichmentUsage: { ...prev.enrichmentUsage, used: 0 },
      } : prev);
    } catch (err) {
      console.error('Failed to reset enrichment:', err);
      alert('Failed to reset enrichment usage');
    }
    setResettingEnrichment(false);
  };

  const handleUpgradeUser = async () => {
    if (!confirm(`Upgrade this user to Premium? Reason: ${grantReason || '(none)'}`)) return;
    setChangingTier(true);
    try {
      const resp = await authFetch(`${API_BASE}?action=admin-upgrade-user`, {
        method: 'POST',
        body: JSON.stringify({ userId, reason: grantReason || 'Admin grant' }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error((err as { error?: string }).error || `HTTP ${resp.status}`);
      }
      // Update local state
      setData(prev => prev ? {
        ...prev,
        subscription: { tier: 'premium', status: 'active', payment_provider: 'admin', admin_grant_reason: grantReason || 'Admin grant' },
        enrichmentUsage: { ...prev.enrichmentUsage, limit: 100 },
      } : prev);
      setGrantReason('');
    } catch (err) {
      console.error('Failed to upgrade user:', err);
      alert('Failed to upgrade user');
    }
    setChangingTier(false);
  };

  const handleDowngradeUser = async () => {
    if (!confirm('Downgrade this user to Free tier? They will lose premium features.')) return;
    setChangingTier(true);
    try {
      const resp = await authFetch(`${API_BASE}?action=admin-downgrade-user`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error((err as { error?: string }).error || `HTTP ${resp.status}`);
      }
      setData(prev => prev ? {
        ...prev,
        subscription: { tier: 'free', status: 'active' },
        enrichmentUsage: { ...prev.enrichmentUsage, limit: 10 },
      } : prev);
    } catch (err) {
      console.error('Failed to downgrade user:', err);
      alert('Failed to downgrade user');
    }
    setChangingTier(false);
  };

  if (loading) return <LoadingSpinner />;
  if (!data) return <p className="text-red-400">Failed to load user details</p>;

  const p = data.profile as Record<string, unknown> | null;
  const ts = data.trustScore as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="inline-flex items-center text-sm text-slate-400 hover:text-white"
      >
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back to Users
      </button>

      {/* Profile header */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div className="flex items-start gap-4">
          {p?.avatar_url ? (
            <img src={p.avatar_url as string} alt="" className="w-16 h-16 rounded-full" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-slate-600 flex items-center justify-center text-xl text-slate-300">
              {(p?.first_name as string || '?')[0]}
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-xl font-bold text-white">
              {String(p?.first_name || '')} {String(p?.last_name || '')}
              {!p?.first_name && !p?.last_name && <span className="text-slate-500">Unnamed User</span>}
            </h3>
            {p?.position ? <p className="text-sm text-slate-400">{String(p.position)}{p?.company ? ` at ${String(p.company)}` : ''}</p> : null}
            {p?.bio ? <p className="text-sm text-slate-500 mt-1 line-clamp-2">{String(p.bio)}</p> : null}
            <p className="text-xs text-slate-600 mt-2 font-mono">{userId}</p>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Trust Score" value={ts?.trust_score as number || 0} sub={`Level ${ts?.trust_level || 1}`} />
        <StatCard label="Total Points" value={data.totalPoints} />
        <StatCard label="Contacts" value={data.contactCount} />
        <StatCard label="Handshakes" value={data.handshakes.length} />
      </div>

      {/* Trust score breakdown */}
      {ts && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h4 className="text-sm font-medium text-slate-400 mb-3">Trust Score Breakdown</h4>
          <div className="grid grid-cols-5 gap-2">
            {[
              { label: 'Handshakes', score: ts.score_handshakes as number, max: 30 },
              { label: 'Wallet', score: ts.score_wallet as number, max: 20 },
              { label: 'Socials', score: ts.score_socials as number, max: 20 },
              { label: 'Events', score: ts.score_events as number, max: 20 },
              { label: 'Community', score: ts.score_community as number, max: 10 },
            ].map(({ label, score, max }) => (
              <div key={label} className="text-center">
                <div className="relative w-full bg-slate-700 rounded-full h-2 mb-1">
                  <div
                    className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${max > 0 ? (score / max) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-sm text-white font-mono">{score}/{max}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Signals */}
      {ts && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h4 className="text-sm font-medium text-slate-400 mb-3">Signals</h4>
          <div className="flex flex-wrap gap-2">
            <Signal label="Wallet Connected" active={ts.wallet_connected as boolean} />
            <Signal label="X Verified" active={ts.x_verified as boolean} />
            <Signal label="X Premium" active={ts.x_premium as boolean} />
            <Signal label="TG Premium" active={ts.telegram_premium as boolean} />
            <Signal label="TG Username" active={ts.has_username as boolean} />
            {ts.wallet_age_days != null && (
              <span className="px-2 py-1 rounded text-xs bg-slate-700 text-slate-300">
                Wallet age: {String(ts.wallet_age_days)}d
              </span>
            )}
            {ts.wallet_tx_count != null && (
              <span className="px-2 py-1 rounded text-xs bg-slate-700 text-slate-300">
                Wallet txs: {String(ts.wallet_tx_count)}
              </span>
            )}
            {ts.telegram_account_age_days != null && (
              <span className="px-2 py-1 rounded text-xs bg-slate-700 text-slate-300">
                TG age: {String(ts.telegram_account_age_days)}d
              </span>
            )}
          </div>
        </div>
      )}

      {/* Linked accounts */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h4 className="text-sm font-medium text-slate-400 mb-3">Linked Accounts</h4>
        <div className="space-y-2 text-sm">
          {data.telegramLink && (
            <p className="text-slate-300">
              Telegram: <span className="text-white font-mono">@{String((data.telegramLink as Record<string, unknown>).telegram_username || 'N/A')}</span>
              <span className="text-slate-500 ml-2">ID: {String((data.telegramLink as Record<string, unknown>).telegram_user_id)}</span>
            </p>
          )}
          {data.wallets.length > 0 && data.wallets.map((w, i) => (
            <p key={i} className="text-slate-300">
              Wallet: <span className="text-white font-mono text-xs">{String((w as Record<string, unknown>).wallet_address)}</span>
              {(w as Record<string, unknown>).verified_at ? <span className="text-green-400 ml-2 text-xs">Verified</span> : null}
            </p>
          ))}
          {/* Subscription tier with upgrade/downgrade controls */}
          <div className="text-slate-300">
            <p>
              Subscription:{' '}
              <span className={`font-bold ${(data.subscription as Record<string, unknown>)?.tier === 'premium' ? 'text-amber-400' : 'text-white'}`}>
                {data.subscription ? String((data.subscription as Record<string, unknown>).tier) : 'free'}
              </span>
              {data.subscription && (
                <span className="text-slate-500 ml-2">
                  ({String((data.subscription as Record<string, unknown>).status)})
                  {String((data.subscription as Record<string, unknown>).payment_provider || '') && (
                    <> via {String((data.subscription as Record<string, unknown>).payment_provider)}</>
                  )}
                </span>
              )}
              {String((data.subscription as Record<string, unknown>)?.admin_grant_reason || '') && (
                <span className="text-slate-500 ml-2 text-xs italic">
                  — {String((data.subscription as Record<string, unknown>).admin_grant_reason)}
                </span>
              )}
            </p>
            <div className="flex items-center gap-2 mt-2">
              {(!data.subscription || (data.subscription as Record<string, unknown>).tier !== 'premium') ? (
                <>
                  <input
                    type="text"
                    placeholder="Grant reason (e.g., Early adopter)"
                    value={grantReason}
                    onChange={(e) => setGrantReason(e.target.value)}
                    className="px-2 py-1 text-xs bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500 w-48"
                  />
                  <button
                    onClick={handleUpgradeUser}
                    disabled={changingTier}
                    className="px-3 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-500 disabled:opacity-40"
                  >
                    {changingTier ? 'Upgrading...' : 'Upgrade to Premium'}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleDowngradeUser}
                  disabled={changingTier}
                  className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-40"
                >
                  {changingTier ? 'Downgrading...' : 'Downgrade to Free'}
                </button>
              )}
            </div>
          </div>
          {p?.twitter_handle ? (
            <p className="text-slate-300">X: <span className="text-white">@{String(p.twitter_handle)}</span></p>
          ) : null}
          {p?.linkedin_url ? (
            <p className="text-slate-300">LinkedIn: <span className="text-white text-xs">{String(p.linkedin_url)}</span></p>
          ) : null}
        </div>
      </div>

      {/* Enrichment usage */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-slate-400 mb-1">Enrichment Usage</h4>
            <p className="text-white">
              <span className="font-mono font-bold text-lg">{data.enrichmentUsage.used}</span>
              <span className="text-slate-400"> / {data.enrichmentUsage.limit}</span>
              <span className="text-slate-500 text-xs ml-2">({data.enrichmentUsage.month})</span>
            </p>
            <div className="w-48 bg-slate-700 rounded-full h-2 mt-2">
              <div
                className={`h-2 rounded-full ${data.enrichmentUsage.used >= data.enrichmentUsage.limit ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(100, (data.enrichmentUsage.used / data.enrichmentUsage.limit) * 100)}%` }}
              />
            </div>
          </div>
          <button
            onClick={handleResetEnrichment}
            disabled={resettingEnrichment || data.enrichmentUsage.used === 0}
            className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {resettingEnrichment ? 'Resetting...' : 'Reset to 0'}
          </button>
        </div>
      </div>

      {/* Recent handshakes */}
      {data.handshakes.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h4 className="text-sm font-medium text-slate-400 mb-3">Recent Handshakes ({data.handshakes.length})</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.handshakes.map((hs) => {
              const h = hs as Record<string, unknown>;
              const isInitiator = h.initiator_user_id === userId;
              return (
                <div key={h.id as string} className="flex items-center justify-between text-xs bg-slate-700/50 rounded px-3 py-2">
                  <div>
                    <span className="text-slate-400">{isInitiator ? 'Initiated to' : 'Received from'}</span>{' '}
                    <span className="text-white font-mono">{truncateId(isInitiator ? (h.receiver_identifier as string || h.receiver_user_id as string || '?') : (h.initiator_user_id as string))}</span>
                    {h.event_title ? <span className="text-slate-500 ml-2">{String(h.event_title)}</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={h.status as string} />
                    <span className="text-slate-500">{formatDate(h.created_at as string)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent points */}
      {data.recentPoints.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h4 className="text-sm font-medium text-slate-400 mb-3">Recent Points ({data.totalPoints} total)</h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {data.recentPoints.map((pt) => {
              const p2 = pt as Record<string, unknown>;
              return (
                <div key={p2.id as string} className="flex items-center justify-between text-xs bg-slate-700/50 rounded px-3 py-1.5">
                  <span className="text-slate-300">{p2.reason as string}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-green-400 font-mono">+{p2.points as number}</span>
                    <span className="text-slate-500">{formatDate(p2.created_at as string)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Signal({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`px-2 py-1 rounded text-xs ${active ? 'bg-green-900/40 text-green-300' : 'bg-slate-700 text-slate-500'}`}>
      {active ? '\u2713' : '\u2717'} {label}
    </span>
  );
}

// ─── Handshakes Section ───────────────────────────────────────────────────────

function HandshakesSection() {
  const [handshakes, setHandshakes] = useState<HandshakeRow[]>([]);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const limit = 25;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page), limit: String(limit),
      };
      if (status) params.status = status;
      if (eventFilter) params.eventTitle = eventFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;

      const [hsData, funnelData] = await Promise.all([
        adminFetch<{ handshakes: HandshakeRow[]; total: number }>('admin-handshakes', params),
        adminFetch<{ funnel: FunnelData }>('admin-handshake-funnel', params),
      ]);

      setHandshakes(hsData.handshakes);
      setTotal(hsData.total);
      setFunnel(funnelData.funnel);
    } catch (err) {
      console.error('Failed to fetch handshakes:', err);
    }
    setLoading(false);
  }, [page, status, eventFilter, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Handshakes ({total})</h3>

      {/* Funnel visualization */}
      {funnel && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h4 className="text-sm font-medium text-slate-400 mb-3">Handshake Funnel</h4>
          <div className="flex items-end gap-2 h-32">
            {[
              { label: 'Initiated', count: funnel.initiated, color: 'bg-slate-500' },
              { label: 'Claimed', count: funnel.claimed, color: 'bg-blue-500' },
              { label: 'Matched', count: funnel.matched, color: 'bg-purple-500' },
              { label: 'Minted', count: funnel.minted, color: 'bg-green-500' },
              { label: 'Expired', count: funnel.expired, color: 'bg-red-500' },
              { label: 'Pending', count: funnel.pending, color: 'bg-yellow-500' },
            ].map(({ label, count, color }) => {
              const maxCount = funnel.initiated || 1;
              const height = Math.max(4, (count / maxCount) * 100);
              return (
                <div key={label} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-white font-mono">{count}</span>
                  <div className="w-full rounded-t" style={{ height: `${height}%` }}>
                    <div className={`w-full h-full ${color} rounded-t`} />
                  </div>
                  <span className="text-[10px] text-slate-400">{label}</span>
                </div>
              );
            })}
          </div>
          {funnel.initiated > 0 && (
            <div className="flex gap-4 mt-3 text-xs text-slate-500">
              <span>Claim rate: {Math.round((funnel.claimed / funnel.initiated) * 100)}%</span>
              <span>Mint rate: {Math.round((funnel.minted / funnel.initiated) * 100)}%</span>
              <span>Expire rate: {Math.round((funnel.expired / funnel.initiated) * 100)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-sm text-white"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="claimed">Claimed</option>
          <option value="matched">Matched</option>
          <option value="minted">Minted</option>
          <option value="expired">Expired</option>
        </select>
        <input
          type="text"
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          onBlur={() => { setPage(1); fetchData(); }}
          placeholder="Filter by event..."
          className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-sm text-white placeholder-slate-400 w-48"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-sm text-white"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-sm text-white"
        />
      </div>

      {/* Table */}
      {loading ? <LoadingSpinner /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase border-b border-slate-700">
                <tr>
                  <th className="py-3 px-3">ID</th>
                  <th className="py-3 px-3">Initiator</th>
                  <th className="py-3 px-3">Receiver</th>
                  <th className="py-3 px-3">Event</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Points</th>
                  <th className="py-3 px-3">NFTs</th>
                  <th className="py-3 px-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {handshakes.map((hs) => (
                  <tr key={hs.id} className="hover:bg-slate-800/50">
                    <td className="py-2 px-3 font-mono text-xs text-slate-400">{truncateId(hs.id)}</td>
                    <td className="py-2 px-3 font-mono text-xs text-white">{truncateId(hs.initiator_user_id)}</td>
                    <td className="py-2 px-3 font-mono text-xs text-white">{hs.receiver_user_id ? truncateId(hs.receiver_user_id) : hs.receiver_identifier}</td>
                    <td className="py-2 px-3 text-slate-300 text-xs max-w-[200px] truncate">{hs.event_title || '—'}</td>
                    <td className="py-2 px-3"><StatusBadge status={hs.status} /></td>
                    <td className="py-2 px-3 text-slate-300 font-mono">{hs.points_awarded}</td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1">
                        {hs.initiator_nft_address && <span className="text-[10px] text-green-400" title={hs.initiator_nft_address}>I-NFT</span>}
                        {hs.receiver_nft_address && <span className="text-[10px] text-green-400" title={hs.receiver_nft_address}>R-NFT</span>}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-slate-400 text-xs">{formatDateTime(hs.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-500">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 text-sm bg-slate-700 text-slate-300 rounded disabled:opacity-40 hover:bg-slate-600"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 text-sm bg-slate-700 text-slate-300 rounded disabled:opacity-40 hover:bg-slate-600"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Events Section ───────────────────────────────────────────────────────────

function EventsSection() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch<{ events: EventRow[]; total: number }>('admin-events')
      .then(data => setEvents(data.events))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Events by Handshake Count</h3>

      {events.length === 0 ? (
        <p className="text-slate-400 text-sm">No events with handshakes yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-400 uppercase border-b border-slate-700">
              <tr>
                <th className="py-3 px-3">#</th>
                <th className="py-3 px-3">Event</th>
                <th className="py-3 px-3">Date</th>
                <th className="py-3 px-3">Total HS</th>
                <th className="py-3 px-3">Minted</th>
                <th className="py-3 px-3">Pending</th>
                <th className="py-3 px-3">Mint Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {events.map((ev, i) => (
                <tr key={ev.eventTitle} className="hover:bg-slate-800/50">
                  <td className="py-2 px-3 text-slate-500">{i + 1}</td>
                  <td className="py-2 px-3 text-white max-w-[300px] truncate">{ev.eventTitle}</td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{formatDate(ev.eventDate)}</td>
                  <td className="py-2 px-3 text-white font-mono">{ev.totalHandshakes}</td>
                  <td className="py-2 px-3 text-green-400 font-mono">{ev.mintedHandshakes}</td>
                  <td className="py-2 px-3 text-yellow-400 font-mono">{ev.pendingHandshakes}</td>
                  <td className="py-2 px-3 text-slate-300">
                    {ev.totalHandshakes > 0 ? `${Math.round((ev.mintedHandshakes / ev.totalHandshakes) * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Trust Distribution Section ───────────────────────────────────────────────

function TrustSection() {
  const [dist, setDist] = useState<TrustDist | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch<TrustDist>('admin-trust-dist')
      .then(setDist)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!dist) return <p className="text-red-400">Failed to load trust data</p>;

  const maxBucket = Math.max(...dist.buckets.map(b => b.count), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Trust Score Distribution</h3>
        <div className="text-right">
          <p className="text-sm text-slate-400">Average: <span className="text-white font-mono font-bold">{dist.avgScore}</span> / 100</p>
          <p className="text-xs text-slate-500">{dist.totalUsers} users</p>
        </div>
      </div>

      {/* Histogram */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="flex items-end gap-1 h-40">
          {dist.buckets.map((b) => {
            const height = Math.max(2, (b.count / maxBucket) * 100);
            return (
              <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs text-white font-mono">{b.count}</span>
                <div
                  className="w-full bg-blue-500 rounded-t transition-all"
                  style={{ height: `${height}%` }}
                />
                <span className="text-[9px] text-slate-400">{b.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Average category breakdown */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h4 className="text-sm font-medium text-slate-400 mb-3">Average Category Scores (per user)</h4>
        <div className="space-y-3">
          {[
            { label: 'Handshakes', value: dist.avgCategories.handshakes, max: 30 },
            { label: 'Wallet', value: dist.avgCategories.wallet, max: 20 },
            { label: 'Socials', value: dist.avgCategories.socials, max: 20 },
            { label: 'Events', value: dist.avgCategories.events, max: 20 },
            { label: 'Community', value: dist.avgCategories.community, max: 10 },
          ].map(({ label, value, max }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-xs text-slate-400 w-20">{label}</span>
              <div className="flex-1 bg-slate-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full"
                  style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs text-white font-mono w-12 text-right">{value}/{max}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Signups Section ──────────────────────────────────────────────────────────

function SignupsSection() {
  const [data, setData] = useState<{ signups: SignupDay[]; telegramLinks: SignupDay[]; totalInPeriod: number; telegramInPeriod: number } | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    adminFetch<{ signups: SignupDay[]; telegramLinks: SignupDay[]; totalInPeriod: number; telegramInPeriod: number }>(
      'admin-signups', { days: String(days) }
    )
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) return <LoadingSpinner />;
  if (!data) return <p className="text-red-400">Failed to load signup data</p>;

  const maxSignup = Math.max(...data.signups.map(s => s.count), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Signup Trends</h3>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-sm text-white"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Signups (period)" value={data.totalInPeriod} sub={`Last ${days} days`} />
        <StatCard label="Telegram Links (period)" value={data.telegramInPeriod} sub={`Last ${days} days`} />
      </div>

      {/* Bar chart */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h4 className="text-sm font-medium text-slate-400 mb-3">Daily Signups</h4>
        <div className="flex items-end gap-px h-32 overflow-x-auto">
          {data.signups.map((s) => {
            const height = Math.max(1, (s.count / maxSignup) * 100);
            return (
              <div
                key={s.date}
                className="flex-shrink-0 flex flex-col items-center justify-end"
                style={{ width: days <= 14 ? '24px' : days <= 30 ? '12px' : '6px' }}
                title={`${s.date}: ${s.count} signups`}
              >
                <div
                  className="w-full bg-blue-500 rounded-t hover:bg-blue-400 transition-colors"
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>
        {days <= 30 && (
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-slate-500">{data.signups[0]?.date}</span>
            <span className="text-[9px] text-slate-500">{data.signups[data.signups.length - 1]?.date}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Loading Spinner ──────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
    </div>
  );
}

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────

export default function AdminDashboard({ onExit }: { onExit: () => void }) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminRole, setAdminRole] = useState<string>('');
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Check admin access
  useEffect(() => {
    adminFetch<{ isAdmin: boolean; role: string }>('admin-check')
      .then(data => {
        setIsAdmin(data.isAdmin);
        setAdminRole(data.role);
      })
      .catch(() => setIsAdmin(false));
  }, []);

  // Load overview stats when on overview tab
  useEffect(() => {
    if (isAdmin && activeTab === 'overview') {
      adminFetch<Stats>('admin-stats')
        .then(setStats)
        .catch(console.error);
    }
  }, [isAdmin, activeTab]);

  // Loading state
  if (isAdmin === null) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto" />
          <p className="mt-4 text-slate-300">Checking admin access...</p>
        </div>
      </div>
    );
  }

  // Not admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-900/40 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-slate-400 mb-6">You don't have admin access. Contact the team to get approved.</p>
          <button
            onClick={onExit}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500"
          >
            Back to App
          </button>
        </div>
      </div>
    );
  }

  const tabs: { key: AdminTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'users', label: 'Users' },
    { key: 'handshakes', label: 'Handshakes' },
    { key: 'events', label: 'Events' },
    { key: 'trust', label: 'Trust Scores' },
    { key: 'signups', label: 'Signups' },
  ];

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="Logo" className="w-8 h-8" />
              <div>
                <h1 className="text-xl font-bold text-white">Convenu Admin</h1>
                <p className="text-xs text-slate-500">{adminRole}</p>
              </div>
            </div>
            <button
              onClick={onExit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-300 bg-slate-700 rounded-md hover:bg-slate-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to App
            </button>
          </div>
        </div>
      </header>

      {/* Tab navigation */}
      <div className="bg-slate-800/50 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-1 overflow-x-auto scrollbar-hide">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setActiveTab(key); setSelectedUserId(null); }}
                className={`py-3 px-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === key
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {activeTab === 'overview' && <OverviewSection stats={stats} />}

        {activeTab === 'users' && (
          selectedUserId
            ? <UserDetailPanel userId={selectedUserId} onBack={() => setSelectedUserId(null)} />
            : <UsersSection onSelectUser={setSelectedUserId} />
        )}

        {activeTab === 'handshakes' && <HandshakesSection />}

        {activeTab === 'events' && <EventsSection />}

        {activeTab === 'trust' && <TrustSection />}

        {activeTab === 'signups' && <SignupsSection />}
      </main>
    </div>
  );
}
