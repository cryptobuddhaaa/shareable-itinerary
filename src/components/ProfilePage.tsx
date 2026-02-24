/**
 * ProfilePage — user profile editor.
 * Reads/writes to /api/profile and displays linked accounts (Google, Telegram, Wallet).
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useUserWallet } from '../hooks/useUserWallet';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { authFetch } from '../lib/authFetch';
import { supabase } from '../lib/supabase';
import { toast } from './Toast';
import { isTelegramWebApp, openTelegramLink } from '../lib/telegram';
import { generateTelegramLinkCode, unlinkTelegram } from '../services/telegramService';

interface ProfileData {
  first_name: string;
  last_name: string;
  company: string;
  position: string;
  bio: string;
  twitter_handle: string;
  linkedin_url: string;
  website: string;
}

const EMPTY_PROFILE: ProfileData = {
  first_name: '',
  last_name: '',
  company: '',
  position: '',
  bio: '',
  twitter_handle: '',
  linkedin_url: '',
  website: '',
};

export default function ProfilePage() {
  const { user } = useAuth();
  const { getPrimaryWallet } = useUserWallet();
  const [profile, setProfile] = useState<ProfileData>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState<string | null>(null);
  const [xVerified, setXVerified] = useState(false);
  const [xConnecting, setXConnecting] = useState(false);
  const [xDisconnecting, setXDisconnecting] = useState(false);
  const [tgLinking, setTgLinking] = useState(false);
  const [walletLinking, setWalletLinking] = useState(false);
  const [walletLoginUrl, setWalletLoginUrl] = useState<string | null>(null);
  const walletUrlRef = useRef<HTMLInputElement>(null);
  const { connected: walletAdapterConnected } = useWallet();

  const wallet = getPrimaryWallet();
  const isMobileOrTelegram = isTelegramWebApp() || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      setLoading(true);
      try {
        // Load profile
        const res = await authFetch('/api/profile');
        if (res.ok) {
          const { profile: data } = await res.json();
          if (data) {
            setProfile({
              first_name: data.first_name || '',
              last_name: data.last_name || '',
              company: data.company || '',
              position: data.position || '',
              bio: data.bio || '',
              twitter_handle: data.twitter_handle || '',
              linkedin_url: data.linkedin_url || '',
              website: data.website || '',
            });
          } else {
            // Pre-fill from user metadata if no profile exists yet
            const meta = user.user_metadata || {};
            const fullName = (meta.full_name || '').split(' ');
            setProfile({
              ...EMPTY_PROFILE,
              first_name: fullName[0] || '',
              last_name: fullName.slice(1).join(' ') || '',
            });
          }
        }

        // Load Telegram link
        const { data: tgLink } = await supabase
          .from('telegram_links')
          .select('telegram_username')
          .eq('user_id', user.id)
          .single();

        if (tgLink?.telegram_username) {
          setTelegramUsername(tgLink.telegram_username);
        }

        // Load X verification status from trust_scores
        const { data: trustData } = await supabase
          .from('trust_scores')
          .select('x_verified')
          .eq('user_id', user.id)
          .single();

        if (trustData?.x_verified) {
          setXVerified(true);
        }
      } catch (err) {
        console.error('Failed to load profile:', err);
      } finally {
        setLoading(false);
      }
    };

    load();

    // Handle X OAuth callback query params
    const params = new URLSearchParams(window.location.search);
    if (params.get('x_verified') === 'true') {
      setXVerified(true);
      toast.success('X account verified successfully');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('x_error')) {
      const errMap: Record<string, string> = {
        denied: 'X authorization was denied',
        invalid_state: 'Invalid OAuth state — please try again',
        expired: 'OAuth session expired — please try again',
        token_exchange: 'Failed to exchange token with X',
        user_fetch: 'Failed to fetch X user info',
        already_linked: 'This X account is already verified by another user',
        server: 'Server error during X verification',
      };
      toast.error(errMap[params.get('x_error')!] || 'X verification failed');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(profile),
      });

      if (res.ok) {
        toast.success('Profile saved');
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to save');
      }
    } catch {
      toast.error('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: keyof ProfileData, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleConnectX = async () => {
    setXConnecting(true);
    try {
      const res = await authFetch('/api/auth/x', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Failed to start X verification');
        return;
      }
      const { authUrl } = await res.json();
      window.location.href = authUrl;
    } catch {
      toast.error('Failed to start X verification');
    } finally {
      setXConnecting(false);
    }
  };

  const handleDisconnectX = async () => {
    setXDisconnecting(true);
    try {
      const res = await authFetch('/api/auth/x', { method: 'DELETE' });
      if (res.ok) {
        setXVerified(false);
        setProfile((prev) => ({ ...prev, twitter_handle: '' }));
        toast.success('X account disconnected');
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to disconnect X');
      }
    } catch {
      toast.error('Failed to disconnect X');
    } finally {
      setXDisconnecting(false);
    }
  };

  const handleLinkTelegram = async () => {
    setTgLinking(true);
    try {
      const { deepLink } = await generateTelegramLinkCode();
      openTelegramLink(deepLink);
      toast.info('Complete linking in Telegram, then refresh this page.');
    } catch {
      toast.error('Failed to generate link code.');
    } finally {
      setTgLinking(false);
    }
  };

  const handleUnlinkTelegram = async () => {
    try {
      await unlinkTelegram();
      setTelegramUsername(null);
      toast.info('Telegram unlinked.');
    } catch {
      toast.error('Failed to unlink Telegram.');
    }
  };

  const handleConnectWallet = async () => {
    setWalletLinking(true);
    try {
      const response = await authFetch('/api/auth/wallet-login', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to generate login link');
      const { url } = await response.json();

      // Try clipboard first
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied! Paste it in your wallet browser (e.g. Phantom).');
      } catch {
        // Fallback: show the URL for manual copy
        setWalletLoginUrl(url);
      }
    } catch {
      toast.error('Failed to generate wallet login link.');
    } finally {
      setWalletLinking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Linked Accounts */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h3 className="text-lg font-semibold text-white mb-4">Linked Accounts</h3>
        <div className="space-y-3">
          <AccountRow
            label="Email"
            value={user?.email || 'Not set'}
            connected={!!user?.email}
          />
          <AccountRow
            label="Google"
            value={user?.app_metadata?.provider === 'google' ? (user.email || 'Connected') : 'Not linked'}
            connected={user?.app_metadata?.provider === 'google'}
          />
          {/* Telegram */}
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${telegramUsername ? 'bg-green-400' : 'bg-slate-600'}`} />
              <span className="text-sm text-slate-300">Telegram</span>
            </div>
            {telegramUsername ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-slate-200">@{telegramUsername}</span>
                <button
                  onClick={handleUnlinkTelegram}
                  className="px-2 py-0.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                >
                  Unlink
                </button>
              </div>
            ) : (
              <button
                onClick={handleLinkTelegram}
                disabled={tgLinking}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {tgLinking ? 'Generating...' : 'Link'}
              </button>
            )}
          </div>
          {/* Wallet */}
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${wallet ? 'bg-green-400' : 'bg-slate-600'}`} />
              <span className="text-sm text-slate-300">Wallet</span>
            </div>
            {wallet ? (
              <span className="text-sm font-mono text-slate-200">
                {wallet.walletAddress.slice(0, 4)}...{wallet.walletAddress.slice(-4)}
              </span>
            ) : isMobileOrTelegram ? (
              <div className="flex flex-col items-end gap-1">
                {walletLoginUrl ? (
                  <div className="flex items-center gap-1">
                    <input
                      ref={walletUrlRef}
                      type="text"
                      readOnly
                      value={walletLoginUrl}
                      onFocus={(e) => e.target.select()}
                      className="w-40 px-2 py-1 bg-slate-900 border border-slate-600 rounded text-[10px] text-white font-mono select-all"
                      style={{ userSelect: 'all', WebkitUserSelect: 'all' } as React.CSSProperties}
                    />
                    <button
                      onClick={() => setWalletLoginUrl(null)}
                      className="px-1 py-1 text-xs text-slate-400 hover:text-white"
                      aria-label="Close"
                    >
                      &times;
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleConnectWallet}
                    disabled={walletLinking}
                    className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    {walletLinking ? 'Generating...' : 'Connect'}
                  </button>
                )}
                <span className="text-[10px] text-slate-500">
                  Copy link &amp; paste in wallet browser
                </span>
              </div>
            ) : walletAdapterConnected ? (
              <span className="text-sm text-slate-400">Verifying...</span>
            ) : (
              <WalletMultiButton
                style={{
                  backgroundColor: 'rgb(51, 65, 85)',
                  height: '28px',
                  fontSize: '12px',
                  padding: '0 12px',
                  borderRadius: '8px',
                }}
              />
            )}
          </div>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${xVerified ? 'bg-green-400' : 'bg-slate-600'}`} />
              <span className="text-sm text-slate-300">X / Twitter</span>
            </div>
            {xVerified ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-slate-200">
                  {profile.twitter_handle || 'Verified'}
                </span>
                <button
                  onClick={handleDisconnectX}
                  disabled={xDisconnecting}
                  className="px-2 py-0.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
                >
                  {xDisconnecting ? '...' : 'Disconnect'}
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnectX}
                disabled={xConnecting}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {xConnecting ? 'Connecting...' : 'Verify'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Profile Info */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h3 className="text-lg font-semibold text-white mb-4">Profile Information</h3>
        <p className="text-sm text-slate-400 mb-4">
          This info is shown to others when you send or receive handshakes.
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FieldInput label="First Name" value={profile.first_name} onChange={(v) => handleChange('first_name', v)} />
            <FieldInput label="Last Name" value={profile.last_name} onChange={(v) => handleChange('last_name', v)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldInput label="Company" value={profile.company} onChange={(v) => handleChange('company', v)} />
            <FieldInput label="Position" value={profile.position} onChange={(v) => handleChange('position', v)} />
          </div>
          <FieldInput label="Bio" value={profile.bio} onChange={(v) => handleChange('bio', v)} multiline />
          <FieldInput label="X / Twitter" value={profile.twitter_handle} onChange={(v) => handleChange('twitter_handle', v)} placeholder="@handle" />
          <FieldInput label="LinkedIn URL" value={profile.linkedin_url} onChange={(v) => handleChange('linkedin_url', v)} placeholder="https://linkedin.com/in/..." />
          <FieldInput label="Website" value={profile.website} onChange={(v) => handleChange('website', v)} placeholder="https://..." />
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountRow({ label, value, connected }: { label: string; value: string; connected: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-slate-600'}`} />
        <span className="text-sm text-slate-300">{label}</span>
      </div>
      <span className={`text-sm font-mono ${connected ? 'text-slate-200' : 'text-slate-500'}`}>{value}</span>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const cls = 'w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={cls}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cls}
        />
      )}
    </div>
  );
}
