import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const { signInWithGoogle, signInWithTelegram, isTelegramMiniApp } = useAuth();

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          <img src="/logo.svg" alt="Logo" className="mx-auto w-24 h-24 mb-4" />
          <h1 className="text-4xl font-bold text-white">Convenu</h1>
          <p className="mt-2 text-sm text-slate-400">All in one trip planning and networking tool</p>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-800 py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div>
            <h2 className="text-2xl font-semibold text-white text-center mb-6">
              Sign in to continue
            </h2>

            {isTelegramMiniApp ? (
              <button
                onClick={signInWithTelegram}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-transparent rounded-lg shadow-sm bg-[#2AABEE] text-sm font-medium text-white hover:bg-[#229ED9] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-[#2AABEE] transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                Sign in with Telegram
              </button>
            ) : (
              <button
                onClick={signInWithGoogle}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-600 rounded-lg shadow-sm bg-slate-700 text-sm font-medium text-white hover:bg-[#229ED9] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-blue-500 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign in with Google
              </button>
            )}

            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-600"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-slate-800 text-slate-400">Why sign in?</span>
                </div>
              </div>

              <div className="mt-6 text-sm text-slate-300 space-y-2">
                <div className="flex items-start">
                  <svg
                    className="w-5 h-5 text-green-400 mr-2 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Save your trip plans and contacts securely</span>
                </div>
                <div className="flex items-start">
                  <svg
                    className="w-5 h-5 text-green-400 mr-2 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Access from any device</span>
                </div>
                <div className="flex items-start">
                  <svg
                    className="w-5 h-5 text-green-400 mr-2 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Share itineraries and manage your network</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          By signing in, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}
