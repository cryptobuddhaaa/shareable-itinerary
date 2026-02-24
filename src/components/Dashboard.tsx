/**
 * Dashboard — shows trust score breakdown (0-100, 5 categories), points total, and handshake history.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useHandshakes } from '../hooks/useHandshakes';
import { useContacts } from '../hooks/useContacts';
import { useUserWallet } from '../hooks/useUserWallet';
import type { TrustScore } from '../models/types';

interface PointEntry {
  id: string;
  points: number;
  reason: string;
  createdAt: string;
  handshakeId: string | null;
}

function mapRowToPoint(row: Record<string, unknown>): PointEntry {
  return {
    id: row.id as string,
    points: row.points as number,
    reason: row.reason as string,
    createdAt: row.created_at as string,
    handshakeId: (row.handshake_id as string) || null,
  };
}

function mapRowToTrust(row: Record<string, unknown>): TrustScore {
  return {
    userId: row.user_id as string,
    trustScore: (row.trust_score as number) || 0,
    scoreHandshakes: (row.score_handshakes as number) || 0,
    scoreWallet: (row.score_wallet as number) || 0,
    scoreSocials: (row.score_socials as number) || 0,
    scoreEvents: (row.score_events as number) || 0,
    scoreCommunity: (row.score_community as number) || 0,
    telegramPremium: row.telegram_premium as boolean,
    hasUsername: row.has_username as boolean,
    telegramAccountAgeDays: row.telegram_account_age_days as number | null,
    walletConnected: row.wallet_connected as boolean,
    walletAgeDays: row.wallet_age_days as number | null,
    walletTxCount: row.wallet_tx_count as number | null,
    walletHasTokens: row.wallet_has_tokens as boolean,
    xVerified: row.x_verified as boolean,
    xPremium: row.x_premium as boolean,
    totalHandshakes: row.total_handshakes as number,
    trustLevel: row.trust_level as number,
    updatedAt: row.updated_at as string,
  };
}

function TrustScoreBadge({ score }: { score: number }) {
  let label: string;
  let color: string;
  let bg: string;
  if (score >= 60) { label = 'Champion'; color = 'text-yellow-300'; bg = 'bg-yellow-900/40'; }
  else if (score >= 40) { label = 'Established'; color = 'text-purple-300'; bg = 'bg-purple-900/40'; }
  else if (score >= 25) { label = 'Trusted'; color = 'text-green-300'; bg = 'bg-green-900/40'; }
  else if (score >= 10) { label = 'Verified'; color = 'text-blue-300'; bg = 'bg-blue-900/40'; }
  else { label = 'Newcomer'; color = 'text-slate-300'; bg = 'bg-slate-700'; }
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${bg} ${color}`}>
      {label}
    </span>
  );
}

function ScoreRing({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (score / max) * 100) : 0;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  let strokeColor: string;
  if (pct >= 75) strokeColor = '#4ade80'; // green
  else if (pct >= 40) strokeColor = '#60a5fa'; // blue
  else if (pct > 0) strokeColor = '#fbbf24'; // yellow
  else strokeColor = '#475569'; // slate

  return (
    <div className="relative w-24 h-24 mx-auto">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#1e293b" strokeWidth="6" />
        <circle
          cx="40" cy="40" r={radius} fill="none"
          stroke={strokeColor} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white font-mono">{score}</span>
        <span className="text-[10px] text-slate-400">/ {max}</span>
      </div>
    </div>
  );
}

// Collapsible category component
function CategorySection({
  title,
  score,
  max,
  color,
  children,
}: {
  title: string;
  score: number;
  max: number;
  color: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pct = max > 0 ? Math.min(100, (score / max) * 100) : 0;

  const barColors: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    amber: 'bg-amber-500',
    cyan: 'bg-cyan-500',
  };

  return (
    <div className="border-b border-slate-700/50 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 py-3 text-left hover:bg-slate-700/20 transition-colors"
      >
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-slate-200">{title}</span>
            <span className="text-sm font-mono text-slate-300">{score}/{max}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
            <div
              className={`h-full rounded-full ${barColors[color] || barColors.blue} transition-all duration-500`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </button>
      {open && (
        <div className="pl-7 pb-3 space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

function SubSignal({ label, active, points }: { label: string; active: boolean; points: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-400' : 'bg-slate-600'}`} />
        <span className={`text-xs ${active ? 'text-slate-300' : 'text-slate-500'}`}>{label}</span>
      </div>
      <span className={`text-xs font-mono ${active ? 'text-green-400' : 'text-slate-600'}`}>
        {active ? points : '+0'}
      </span>
    </div>
  );
}

function PlaceholderMessage({ text }: { text: string }) {
  return (
    <p className="text-xs text-slate-500 italic py-1">{text}</p>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { handshakes } = useHandshakes();
  const { contacts } = useContacts();
  const { getPrimaryWallet } = useUserWallet();
  const [trustScore, setTrustScore] = useState<TrustScore | null>(null);
  const [pointEntries, setPointEntries] = useState<PointEntry[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [loading, setLoading] = useState(true);

  const wallet = getPrimaryWallet();

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      setLoading(true);
      try {
        // Trigger trust score recomputation before reading
        const session = (await supabase.auth.getSession()).data.session;
        if (session?.access_token) {
          await fetch('/api/trust/compute', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }).catch(() => { /* non-fatal — read stale data below */ });
        }

        const { data: trustData } = await supabase
          .from('trust_scores')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (trustData) {
          setTrustScore(mapRowToTrust(trustData));
        }

        const { data: pointsData } = await supabase
          .from('user_points')
          .select('id, points, reason, created_at, handshake_id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (pointsData) {
          setPointEntries(pointsData.map(mapRowToPoint));
        }

        // Use DB function for accurate total (not limited to 20 display entries)
        const { data: totalData } = await supabase.rpc('get_user_total_points', { p_user_id: user.id });
        if (typeof totalData === 'number') {
          setTotalPoints(totalData);
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user]);

  const pendingHandshakes = handshakes.filter((h) => h.status === 'pending' || h.status === 'claimed');
  const matchedHandshakes = handshakes.filter((h) => h.status === 'matched');
  const mintedHandshakes = handshakes.filter((h) => h.status === 'minted');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Trust Score" value={trustScore ? `${trustScore.trustScore}/100` : '--'} color="purple" />
        <StatCard label="Total Points" value={totalPoints.toString()} color="green" />
        <StatCard label="Handshakes" value={mintedHandshakes.length.toString()} color="blue" />
        <StatCard
          label="Wallet"
          value={wallet ? `${wallet.walletAddress.slice(0, 4)}...${wallet.walletAddress.slice(-4)}` : 'Not linked'}
          color={wallet ? 'green' : 'slate'}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        {/* Trust Score Breakdown */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Trust Score</h3>
            {trustScore && <TrustScoreBadge score={trustScore.trustScore} />}
          </div>

          {trustScore ? (
            <>
              <ScoreRing score={trustScore.trustScore} max={100} />

              <div className="mt-4">
                <CategorySection title="Handshakes" score={trustScore.scoreHandshakes} max={30} color="blue">
                  <SubSignal
                    label={`Minted handshakes (${trustScore.totalHandshakes}/30)`}
                    active={trustScore.totalHandshakes > 0}
                    points={`+${trustScore.scoreHandshakes}`}
                  />
                  <p className="text-xs text-slate-500 mt-1">1 point per successful handshake, max 30</p>
                </CategorySection>

                <CategorySection title="Wallet" score={trustScore.scoreWallet} max={20} color="green">
                  <SubSignal label="Wallet connected" active={trustScore.walletConnected} points="+5" />
                  <SubSignal
                    label={`Wallet age > 90 days${trustScore.walletAgeDays != null ? ` (${trustScore.walletAgeDays}d)` : ''}`}
                    active={trustScore.walletAgeDays != null && trustScore.walletAgeDays > 90}
                    points="+5"
                  />
                  <SubSignal
                    label={`Transaction count > 10${trustScore.walletTxCount != null ? ` (${trustScore.walletTxCount})` : ''}`}
                    active={trustScore.walletTxCount != null && trustScore.walletTxCount > 10}
                    points="+5"
                  />
                  <SubSignal label="Holds tokens/NFTs" active={trustScore.walletHasTokens} points="+5" />
                </CategorySection>

                <CategorySection title="Socials" score={trustScore.scoreSocials} max={20} color="purple">
                  <SubSignal label="Telegram Premium" active={trustScore.telegramPremium} points="+4" />
                  <SubSignal label="Telegram username" active={trustScore.hasUsername} points="+4" />
                  <SubSignal
                    label={`Telegram account age > 1yr${trustScore.telegramAccountAgeDays ? ` (${Math.floor(trustScore.telegramAccountAgeDays / 365)}y)` : ''}`}
                    active={!!trustScore.telegramAccountAgeDays && trustScore.telegramAccountAgeDays > 365}
                    points="+4"
                  />
                  <SubSignal label="Verified X account" active={trustScore.xVerified} points="+4" />
                  <SubSignal label="X Premium" active={trustScore.xPremium} points="+4" />
                </CategorySection>

                <CategorySection title="Events" score={trustScore.scoreEvents} max={20} color="amber">
                  <PlaceholderMessage text="Coming soon: Event organizers will be able to issue Proof of Attendance soulbound NFTs to attendees. Verified event attendance will contribute up to 20 points to your Trust Score." />
                </CategorySection>

                <CategorySection title="Community" score={trustScore.scoreCommunity} max={10} color="cyan">
                  <PlaceholderMessage text="Coming soon: Communities and organizations can register on Convenu and vouch for their members. Community vouches will contribute up to 10 points to your Trust Score." />
                </CategorySection>
              </div>
            </>
          ) : (
            <div className="text-center py-6">
              <p className="text-slate-400">No trust data yet.</p>
              <p className="text-slate-500 text-sm mt-1">Link your socials and wallet in your Profile to get started.</p>
            </div>
          )}
        </div>

        {/* Handshake Status */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-white mb-4">Handshakes</h3>

          <div className="space-y-3 mb-4">
            <HandshakeStatRow label="Pending" count={pendingHandshakes.length} color="yellow" />
            <HandshakeStatRow label="Matched" count={matchedHandshakes.length} color="blue" />
            <HandshakeStatRow label="Minted" count={mintedHandshakes.length} color="green" />
          </div>

          {handshakes.length > 0 ? (
            <div className="border-t border-slate-700 pt-3 mt-3">
              <h4 className="text-sm font-medium text-slate-400 mb-2">Recent</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {handshakes.slice(0, 8).map((h) => {
                  const isReceiverPending = (h.status === 'pending' || h.status === 'claimed') && h.initiatorUserId !== user?.id;
                  const nftSig = h.status === 'minted'
                    ? (h.initiatorUserId === user?.id ? h.initiatorNftAddress : h.receiverNftAddress)
                    : null;
                  const cluster = (import.meta.env.VITE_SOLANA_NETWORK as string) || 'devnet';
                  const explorerUrl = nftSig
                    ? `https://explorer.solana.com/tx/${nftSig}${cluster !== 'mainnet-beta' ? `?cluster=${cluster}` : ''}`
                    : null;
                  return (
                    <div key={h.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusDot status={h.status} />
                        <span className="text-slate-300 truncate">
                          {h.initiatorUserId === user?.id
                            ? `To ${(() => {
                                const c = contacts.find(ct => ct.id === h.contactId);
                                return c ? `${c.firstName} ${c.lastName}`.trim() : h.receiverIdentifier;
                              })()}`
                            : `From ${h.initiatorName || h.receiverIdentifier || 'Unknown'}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        {isReceiverPending && (
                          <button
                            onClick={() => {
                              window.location.href = `${window.location.pathname}?claim=${h.id}`;
                            }}
                            className="px-2 py-0.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded transition-colors whitespace-nowrap"
                            aria-label={`Claim handshake from ${h.initiatorName || 'unknown'}`}
                          >
                            Claim
                          </button>
                        )}
                        {explorerUrl && (
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-400 hover:text-green-300 hover:underline text-xs whitespace-nowrap flex items-center gap-0.5"
                            title="View Minted Handshake on Solana Explorer"
                          >
                            Minted Handshake
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        )}
                        <span className="text-slate-500 text-xs whitespace-nowrap">
                          {new Date(h.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm">No handshakes yet.</p>
              <p className="text-slate-500 text-xs mt-1">Go to Contacts and tap "Handshake" on a contact.</p>
            </div>
          )}
        </div>
      </div>

      {/* Points History */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Points History</h3>
          <span className="text-green-400 font-mono font-bold text-lg">{totalPoints} pts</span>
        </div>

        {pointEntries.length > 0 ? (
          <div className="divide-y divide-slate-700/50">
            {pointEntries.map((entry) => {
              const hs = entry.handshakeId
                ? handshakes.find(h => h.id === entry.handshakeId)
                : null;
              const nftSig = hs?.status === 'minted'
                ? (hs.initiatorUserId === user?.id ? hs.initiatorNftAddress : hs.receiverNftAddress)
                : null;
              const cluster = (import.meta.env.VITE_SOLANA_NETWORK as string) || 'devnet';
              const nftUrl = nftSig
                ? `https://explorer.solana.com/tx/${nftSig}${cluster !== 'mainnet-beta' ? `?cluster=${cluster}` : ''}`
                : null;

              return (
                <div key={entry.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm text-slate-200">{entry.reason}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString()}</p>
                      {nftUrl && (
                        <a
                          href={nftUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 hover:text-green-300 hover:underline text-xs flex items-center gap-0.5"
                          title="View Minted Handshake on Solana Explorer"
                        >
                          Minted Handshake
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                  <span className="text-green-400 font-mono font-medium">+{entry.points}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <svg className="w-10 h-10 mx-auto text-slate-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-slate-400 text-sm">No points earned yet.</p>
            <p className="text-slate-500 text-xs mt-1">Complete handshakes to earn points.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    purple: 'border-purple-700/50 bg-purple-900/20',
    green: 'border-green-700/50 bg-green-900/20',
    blue: 'border-blue-700/50 bg-blue-900/20',
    slate: 'border-slate-700 bg-slate-800',
  };
  const textMap: Record<string, string> = {
    purple: 'text-purple-300',
    green: 'text-green-300',
    blue: 'text-blue-300',
    slate: 'text-slate-400',
  };

  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.slate}`}>
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-1 font-mono ${textMap[color] || textMap.slate}`}>{value}</p>
    </div>
  );
}

function HandshakeStatRow({ label, count, color }: { label: string; count: number; color: string }) {
  const dotColors: Record<string, string> = {
    yellow: 'bg-yellow-400',
    blue: 'bg-blue-400',
    green: 'bg-green-400',
  };
  const barColors: Record<string, string> = {
    yellow: 'bg-yellow-900/30',
    blue: 'bg-blue-900/30',
    green: 'bg-green-900/30',
  };

  return (
    <div className="flex items-center gap-3">
      <div className={`w-2 h-2 rounded-full ${dotColors[color]}`} />
      <span className="text-sm text-slate-300 w-20">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden">
        {count > 0 && (
          <div
            className={`h-full rounded-full ${barColors[color]}`}
            style={{ width: `${Math.min(100, count * 20)}%` }}
          />
        )}
      </div>
      <span className="text-sm font-mono text-slate-400 w-8 text-right">{count}</span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-400',
    claimed: 'bg-orange-400',
    matched: 'bg-blue-400',
    minted: 'bg-green-400',
    expired: 'bg-red-400',
  };
  return <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors[status] || 'bg-slate-500'}`} />;
}
