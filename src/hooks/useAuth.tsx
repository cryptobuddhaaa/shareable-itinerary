import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { toast } from '../components/Toast';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isTelegramMiniApp: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithTelegram: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  isTelegramMiniApp: false,
  signInWithGoogle: async () => {},
  signInWithTelegram: async () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

/** Check if we're running inside a Telegram Mini App */
function getTelegramInitData(): string | null {
  try {
    const tg = window.Telegram?.WebApp;
    if (tg && tg.initData && tg.initData.length > 0) {
      return tg.initData;
    }
  } catch {
    // Not in Telegram context
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isTelegramMiniApp] = useState(() => getTelegramInitData() !== null);
  // Guard: don't let onAuthStateChange set loading=false while Telegram auth is in progress
  const telegramAuthInProgress = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function initAuth() {
      // Wait for Telegram SDK to load (if running inside Telegram)
      if (window.__tgSdkReady) await window.__tgSdkReady;

      // Signal to Telegram that the web app is ready (hides Telegram's loading spinner)
      try {
        const tg = window.Telegram?.WebApp;
        if (tg) {
          tg.ready();
          tg.expand();
        }
      } catch { /* not in Telegram context */ }

      // First, check for existing Supabase session
      const { data: { session: existingSession } } = await supabase.auth.getSession();

      if (existingSession) {

        if (!cancelled) {
          setSession(existingSession);
          setUser(existingSession.user);
          setLoading(false);
        }
        return;
      }

      // Check for wallet_login token in URL (Telegram user opening in wallet browser)
      const urlParams = new URLSearchParams(window.location.search);
      const walletLoginToken = urlParams.get('wallet_login');
      if (walletLoginToken) {
        // Clean wallet_login from URL but preserve other params (e.g. ?claim=)
        const cleanParams = new URLSearchParams(urlParams);
        cleanParams.delete('wallet_login');
        const cleanSearch = cleanParams.toString();
        window.history.replaceState({}, '', window.location.pathname + (cleanSearch ? `?${cleanSearch}` : ''));
        try {
          const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
            token_hash: walletLoginToken,
            type: 'magiclink',
          });
          if (otpError) {
            console.error('[Auth] Wallet login verification failed:', otpError);
            toast.error('Login link expired or invalid. Please generate a new one.');
          } else if (!cancelled && otpData?.session) {
            setSession(otpData.session);
            setUser(otpData.session.user);
            setLoading(false);
            return;
          }
        } catch (err) {
          console.error('[Auth] Wallet login error:', err);
          toast.error('Login link failed. Please try again.');
        }
      }

      // No existing session — check if we're in a Telegram Mini App
      const initData = getTelegramInitData();


      if (initData) {
        telegramAuthInProgress.current = true;
        try {

          const response = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData }),
          });

          if (!response.ok) {
            const errData = await response.json();
            console.error('[Auth] Telegram auth failed:', errData);
            toast.error('Telegram authentication failed');
            telegramAuthInProgress.current = false;
            if (!cancelled) setLoading(false);
            return;
          }

          const { token_hash, new_account } = await response.json();


          // Verify the OTP token to establish a real Supabase session
          const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
            token_hash,
            type: 'magiclink',
          });

          telegramAuthInProgress.current = false;

          if (otpError) {
            console.error('[Auth] OTP verification failed:', otpError);
            toast.error('Failed to establish session');
          } else {

            // Set session directly from verifyOtp response
            if (!cancelled && otpData?.session) {
              setSession(otpData.session);
              setUser(otpData.session.user);

              // Hint: if this is a brand-new synthetic account, the user might
              // already have a Google/email account they should link to.
              if (new_account) {
                toast.info(
                  'Already have an account? Link your Telegram from the web app \u2192 Contacts \u2192 Link Telegram to merge your data.'
                );
              }
            }
          }
        } catch (err) {
          console.error('[Auth] Telegram auth error:', err);
          toast.error('Telegram authentication failed');
          telegramAuthInProgress.current = false;
        }
      }

      if (!cancelled) {
        setLoading(false);
      }
    }

    initAuth();

    // Listen for auth changes (covers Google OAuth redirect, token refresh, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) {
        setSession(session);
        setUser(session?.user ?? null);
        // Don't set loading=false if Telegram auth is still in progress
        // (the INITIAL_SESSION event fires with null before Telegram auth completes)
        if (!telegramAuthInProgress.current) {
          setLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      console.error('Error signing in with Google:', error.message);
      toast.error('Failed to sign in with Google. Please try again.');
    }
  };

  const signInWithTelegram = async () => {
    const initData = getTelegramInitData();
    if (!initData) {
      toast.error('Telegram data not available. Please open the app from Telegram.');
      return;
    }

    setLoading(true);
    telegramAuthInProgress.current = true;

    try {

      const response = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });

      if (!response.ok) {
        const errData = await response.json();
        console.error('[Auth] Telegram auth failed:', errData);
        toast.error('Telegram authentication failed');
        telegramAuthInProgress.current = false;
        setLoading(false);
        return;
      }

      const { token_hash, new_account: newAcct } = await response.json();

      const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
        token_hash,
        type: 'magiclink',
      });

      telegramAuthInProgress.current = false;

      if (otpError) {
        console.error('[Auth] OTP verification failed:', otpError);
        toast.error('Failed to establish session');
      } else {

        if (otpData?.session) {
          setSession(otpData.session);
          setUser(otpData.session.user);

          if (newAcct) {
            toast.info(
              'Already have an account? Link your Telegram from the web app \u2192 Contacts \u2192 Link Telegram to merge your data.'
            );
          }
        }
      }
    } catch (err) {
      console.error('[Auth] Telegram auth error:', err);
      toast.error('Telegram authentication failed');
      telegramAuthInProgress.current = false;
    }

    setLoading(false);
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out:', error.message);
      toast.error('Failed to sign out. Please try again.');
    }
    // If in Telegram Mini App, close the app on sign out
    if (isTelegramMiniApp) {
      try {
        window.Telegram?.WebApp.close();
      } catch {
        // Ignore if close fails
      }
    }
  };

  const value = {
    user,
    session,
    loading,
    isTelegramMiniApp,
    signInWithGoogle,
    signInWithTelegram,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
