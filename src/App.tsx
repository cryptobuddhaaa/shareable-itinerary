import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { useItinerary } from './hooks/useItinerary';
import { useContacts } from './hooks/useContacts';
import { shareService } from './services/shareService';
import Login from './components/Login';
import ItineraryForm from './components/ItineraryForm';
import ItineraryList from './components/ItineraryList';
import ItineraryTimeline from './components/ItineraryTimeline';
import ShareDialog from './components/ShareDialog';
import ContactsPage from './components/ContactsPage';
import type { Itinerary } from './models/types';
import { Toaster } from './components/Toast';
import { ConfirmDialog, useConfirmDialog } from './components/ConfirmDialog';
import { WalletButton } from './components/WalletButton';
import { useUserWallet } from './hooks/useUserWallet';
import { useHandshakes } from './hooks/useHandshakes';
import { HandshakeClaimPage } from './components/HandshakeClaimPage';
import Dashboard from './components/Dashboard';

type ActiveTab = 'itinerary' | 'contacts' | 'shared' | 'dashboard';

function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { currentItinerary, itineraries, initialize, initialized, reset } = useItinerary();
  const { initialize: initializeContacts, initialized: contactsInitialized, reset: resetContacts } = useContacts();
  const { initialize: initializeWallets, initialized: walletsInitialized, reset: resetWallets } = useUserWallet();
  const { initialize: initializeHandshakes, initialized: handshakesInitialized, reset: resetHandshakes } = useHandshakes();
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('itinerary');
  const [prevItineraryCount, setPrevItineraryCount] = useState(itineraries.length);
  const [sharedItinerary, setSharedItinerary] = useState<Itinerary | null>(null);
  const [claimHandshakeId, setClaimHandshakeId] = useState<string | null>(null);
  const [viewedSharedItineraries, setViewedSharedItineraries] = useState<Itinerary[]>([]);
  const [selectedSharedItinerary, setSelectedSharedItinerary] = useState<Itinerary | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  const itinerary = currentItinerary();

  // Load viewed shared itineraries from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('viewedSharedItineraries');
    if (stored) {
      try {
        setViewedSharedItineraries(JSON.parse(stored));
      } catch (e) {
        console.error('Error loading viewed shared itineraries:', e);
      }
    }
  }, []);

  // Save viewed shared itineraries to localStorage whenever it changes
  useEffect(() => {
    if (viewedSharedItineraries.length > 0) {
      localStorage.setItem('viewedSharedItineraries', JSON.stringify(viewedSharedItineraries));
    }
  }, [viewedSharedItineraries]);

  // Check for handshake claim in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const claimId = params.get('claim');
    if (claimId) {
      setClaimHandshakeId(claimId);
    }
  }, []);

  // Check for shared itinerary in URL on mount
  useEffect(() => {
    const loadSharedItinerary = async () => {
      const urlItinerary = await shareService.loadFromUrl();
      if (urlItinerary) {
        if (user) {
          // If user is logged in, add to viewed shared itineraries
          setViewedSharedItineraries((prev) => {
            // Check if already exists
            const exists = prev.some(item => item.id === urlItinerary.id);
            if (exists) {
              return prev;
            }
            return [urlItinerary, ...prev];
          });
          setActiveTab('shared');
          setSelectedSharedItinerary(urlItinerary);
          // Clear the URL parameter
          window.history.replaceState({}, '', window.location.pathname);
        } else {
          // If not logged in, show the standalone shared view
          setSharedItinerary(urlItinerary);
        }
      }
    };
    loadSharedItinerary();
  }, [user]);

  // Initialize itineraries and contacts when user logs in
  useEffect(() => {
    if (user && !initialized) {
      initialize(user.id);
    } else if (!user && initialized) {
      reset();
    }

    if (user && !contactsInitialized) {
      initializeContacts(user.id);
    } else if (!user && contactsInitialized) {
      resetContacts();
    }

    if (user && !walletsInitialized) {
      initializeWallets(user.id);
    } else if (!user && walletsInitialized) {
      resetWallets();
    }

    if (user && !handshakesInitialized) {
      initializeHandshakes(user.id);
    } else if (!user && handshakesInitialized) {
      resetHandshakes();
    }
  }, [user, initialized, initialize, reset, contactsInitialized, initializeContacts, resetContacts, walletsInitialized, initializeWallets, resetWallets, handshakesInitialized, initializeHandshakes, resetHandshakes]);

  // This effect is removed - we handle shared itineraries separately now

  // Close create form when a new itinerary is created
  useEffect(() => {
    if (itineraries.length > prevItineraryCount && showCreateForm) {
      setShowCreateForm(false);
    }
    setPrevItineraryCount(itineraries.length);
  }, [itineraries.length, prevItineraryCount, showCreateForm]);

  // Keyboard shortcut: 'n' to create new itinerary (when on itinerary tab)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'n' && activeTab === 'itinerary' && !showCreateForm) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        setShowCreateForm(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, showCreateForm]);

  // Pull-to-refresh
  const [refreshing, setRefreshing] = useState(false);
  const pullStartY = useRef(0);
  const pullRef = useRef<HTMLDivElement>(null);

  const handleRefresh = useCallback(async () => {
    if (!user || refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([initialize(user.id), initializeContacts(user.id)]);
    } catch {
      // ignore
    }
    setRefreshing(false);
  }, [user, refreshing, initialize, initializeContacts]);

  useEffect(() => {
    const el = pullRef.current;
    if (!el) return;

    let startY = 0;
    let pulling = false;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pulling) return;
      const diff = e.touches[0].clientY - startY;
      pullStartY.current = diff;
    };
    const onTouchEnd = () => {
      if (pulling && pullStartY.current > 80) {
        handleRefresh();
      }
      pulling = false;
      pullStartY.current = 0;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [handleRefresh]);

  // Show loading state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
          <p className="mt-4 text-slate-300">Loading...</p>
        </div>
      </div>
    );
  }

  // If there's a handshake claim in the URL, show the claim page
  if (claimHandshakeId) {
    return (
      <HandshakeClaimPage
        handshakeId={claimHandshakeId}
        onDone={() => {
          setClaimHandshakeId(null);
          window.history.replaceState({}, '', window.location.pathname);
          // Re-fetch handshakes so Dashboard shows the updated state
          if (user) initializeHandshakes(user.id);
        }}}
      />
    );
  }

  // If there's a shared itinerary in the URL, show it (for both logged-in and non-logged-in users)
  if (sharedItinerary) {
    return (
      <div className="min-h-screen bg-slate-900">
        <header className="bg-slate-800 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
              <div className="flex items-center gap-3 flex-shrink-0">
                <img src="/logo.svg" alt="Logo" className="w-10 h-10 sm:w-12 sm:h-12" />
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-white">Shared Itinerary</h1>
                  <p className="text-sm text-slate-300 mt-1">{sharedItinerary.title}</p>
                  {sharedItinerary.createdByName && (
                    <p className="text-xs text-slate-400 mt-1">
                      Shared by {sharedItinerary.createdByName}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-4">
                {user ? (
                  <>
                    <a
                      href={window.location.origin + window.location.pathname}
                      className="inline-flex items-center px-3 sm:px-4 py-2 border border-slate-600 text-xs sm:text-sm font-medium rounded-md text-slate-300 bg-slate-700 hover:bg-slate-600 whitespace-nowrap"
                    >
                      <svg className="w-4 h-4 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                      </svg>
                      <span className="hidden sm:inline">Back to My Itineraries</span>
                      <span className="sm:hidden">Back</span>
                    </a>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium text-white">{user?.user_metadata?.full_name || user?.email}</p>
                        <p className="text-xs text-slate-400">{user?.email}</p>
                      </div>
                      {user?.user_metadata?.avatar_url && (
                        <img
                          src={user.user_metadata.avatar_url}
                          alt="Profile"
                          className="w-8 h-8 sm:w-10 sm:h-10 rounded-full"
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <a
                    href={window.location.origin + window.location.pathname}
                    className="inline-flex items-center px-3 sm:px-4 py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
                  >
                    <span className="hidden sm:inline">Get Started</span>
                    <span className="sm:hidden">Get Started</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
          <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-200">
              You're viewing a shared itinerary{sharedItinerary.createdByName ? ` from ${sharedItinerary.createdByName}` : ''}.
              {!user && (
                <>
                  {' '}<a href={window.location.origin + window.location.pathname} className="underline font-medium">Sign in</a> to plan your own trips, manage events, and build your contact network!
                </>
              )}
            </p>
          </div>
          <ItineraryTimeline sharedItinerary={sharedItinerary} readOnly={true} />
        </main>
      </div>
    );
  }

  // Show login if not authenticated and no shared itinerary
  if (!user) {
    return <Login />;
  }

  return (
    <div ref={pullRef} className="min-h-screen bg-slate-900">
      {refreshing && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center py-2 bg-blue-600/90">
          <div className="flex items-center gap-2 text-white text-sm">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
            Refreshing...
          </div>
        </div>
      )}
      <header className="bg-slate-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-shrink-0">
              <img src="/logo.svg" alt="Logo" className="w-10 h-10 sm:w-12 sm:h-12" />
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white">Itinerary & Contact Manager</h1>
                <p className="text-xs sm:text-sm text-slate-400 mt-1">All in one trip planning and networking tool</p>
              </div>
            </div>
            <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-4">
              <WalletButton />
              {itinerary && (
                <button
                  onClick={() => setShowShareDialog(true)}
                  className="inline-flex items-center px-3 sm:px-4 py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-blue-500"
                >
                  <svg className="w-4 h-4 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  <span className="hidden sm:inline">Share</span>
                </button>
              )}
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-white">{user?.user_metadata?.full_name || user?.email}</p>
                  <p className="text-xs text-slate-400">{user?.email}</p>
                </div>
                {user?.user_metadata?.avatar_url && (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt="Profile"
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full"
                  />
                )}
                <button
                  onClick={signOut}
                  className="inline-flex items-center px-2 sm:px-3 py-2 border border-slate-600 text-xs sm:text-sm font-medium rounded-md text-slate-300 bg-slate-700 hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-blue-500"
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 pb-20 sm:pb-8 sm:px-6 lg:px-8">
        {itineraries.length === 0 ? (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Create Your First Trip</h2>
              <p className="text-slate-400">Plan your trip with events and activities, and connect with people you meet</p>
            </div>
            <ItineraryForm />
          </div>
        ) : (
          <div>
            <div className="mb-6 -mx-4 sm:mx-0 hidden sm:block">
              <nav className="flex space-x-4 border-b border-slate-700 overflow-x-auto scrollbar-hide">
                <button
                  onClick={() => setActiveTab('itinerary')}
                  className={`py-2 px-3 sm:px-4 border-b-2 font-medium text-xs sm:text-sm whitespace-nowrap transition-colors ${
                    activeTab === 'itinerary'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-500'
                  }`}
                >
                  My Itineraries
                </button>
                <button
                  onClick={() => setActiveTab('shared')}
                  className={`py-2 px-3 sm:px-4 border-b-2 font-medium text-xs sm:text-sm whitespace-nowrap transition-colors ${
                    activeTab === 'shared'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-500'
                  }`}
                >
                  <span className="hidden sm:inline">Others' Itineraries</span>
                  <span className="sm:hidden">Others'</span>
                  {viewedSharedItineraries.length > 0 && (
                    <span className="ml-1 sm:ml-2 inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/50 text-blue-300">
                      {viewedSharedItineraries.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('contacts')}
                  className={`py-2 px-3 sm:px-4 border-b-2 font-medium text-xs sm:text-sm whitespace-nowrap transition-colors ${
                    activeTab === 'contacts'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-500'
                  }`}
                >
                  Contacts
                </button>
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`py-2 px-3 sm:px-4 border-b-2 font-medium text-xs sm:text-sm whitespace-nowrap transition-colors ${
                    activeTab === 'dashboard'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-500'
                  }`}
                >
                  Dashboard
                </button>
              </nav>
            </div>

            {activeTab === 'itinerary' && (
              <>
                <ItineraryList />

                {showCreateForm && (
              <div className="bg-slate-800 shadow rounded-lg p-6 mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-white">Create New Itinerary</h2>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="text-slate-400 hover:text-slate-200"
                    aria-label="Close"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <ItineraryForm />
              </div>
            )}

                {!showCreateForm && (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="w-full mb-6 inline-flex items-center justify-center px-4 py-3 border-2 border-dashed border-slate-600 text-sm font-medium rounded-lg text-slate-300 bg-slate-800/50 hover:border-slate-500 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-blue-500"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create New Itinerary
                  </button>
                )}

                {itinerary && <ItineraryTimeline />}
              </>
            )}

            {activeTab === 'shared' && (
              <div>
                {viewedSharedItineraries.length === 0 ? (
                  <div className="text-center py-12 bg-slate-800 rounded-lg shadow">
                    <svg className="mx-auto h-12 w-12 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    <h3 className="mt-2 text-sm font-medium text-white">No shared itineraries yet</h3>
                    <p className="mt-1 text-sm text-slate-400">
                      When someone shares an itinerary with you, it will appear here
                    </p>
                  </div>
                ) : (
                  <div>
                    {!selectedSharedItinerary ? (
                      <div className="space-y-4">
                        <div className="flex justify-between items-center mb-4">
                          <div>
                            <h2 className="text-lg font-semibold text-white">Shared Itineraries</h2>
                            <p className="text-sm text-slate-400 mt-1">
                              Itineraries that have been shared with you
                            </p>
                          </div>
                          {viewedSharedItineraries.length > 0 && (
                            <button
                              onClick={async () => {
                                const confirmed = await confirm({
                                  title: 'Clear shared itineraries',
                                  message: 'Remove all shared itineraries from this list?',
                                  confirmLabel: 'Clear All',
                                  variant: 'danger',
                                });
                                if (confirmed) {
                                  setViewedSharedItineraries([]);
                                  localStorage.removeItem('viewedSharedItineraries');
                                }
                              }}
                              className="text-sm text-red-400 hover:text-red-300"
                            >
                              Clear All
                            </button>
                          )}
                        </div>
                        <div className="grid gap-4">
                          {viewedSharedItineraries.map((sharedItem) => (
                            <div
                              key={sharedItem.id}
                              className="bg-slate-800 shadow rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer border border-slate-700"
                              onClick={() => setSelectedSharedItinerary(sharedItem)}
                            >
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <h3 className="text-lg font-semibold text-white">{sharedItem.title}</h3>
                                  <p className="text-sm text-slate-300 mt-1">{sharedItem.location}</p>
                                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                                    <span>{new Date(sharedItem.startDate).toLocaleDateString()} - {new Date(sharedItem.endDate).toLocaleDateString()}</span>
                                    {sharedItem.createdByName && (
                                      <span>Shared by {sharedItem.createdByName}</span>
                                    )}
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setViewedSharedItineraries((prev) =>
                                      prev.filter((item) => item.id !== sharedItem.id)
                                    );
                                  }}
                                  className="text-slate-500 hover:text-red-400"
                                  title="Remove from list"
                                  aria-label="Remove from list"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="mb-4">
                          <button
                            onClick={() => setSelectedSharedItinerary(null)}
                            className="inline-flex items-center text-sm text-slate-400 hover:text-white"
                          >
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                            Back to list
                          </button>
                        </div>
                        <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 mb-6">
                          <p className="text-sm text-blue-200">
                            Viewing shared itinerary: <strong>{selectedSharedItinerary.title}</strong>
                            {selectedSharedItinerary.createdByName && ` from ${selectedSharedItinerary.createdByName}`}
                          </p>
                        </div>
                        <ItineraryTimeline sharedItinerary={selectedSharedItinerary} readOnly={true} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'contacts' && <ContactsPage />}

            {activeTab === 'dashboard' && <Dashboard />}
          </div>
        )}
      </main>

      {/* Mobile bottom navigation */}
      {itineraries.length > 0 && (
        <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 z-40">
          <div className="flex justify-around">
            <button
              onClick={() => setActiveTab('itinerary')}
              className={`flex-1 flex flex-col items-center py-2 text-xs ${
                activeTab === 'itinerary' ? 'text-blue-400' : 'text-slate-400'
              }`}
            >
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Trips
            </button>
            <button
              onClick={() => setActiveTab('shared')}
              className={`flex-1 flex flex-col items-center py-2 text-xs relative ${
                activeTab === 'shared' ? 'text-blue-400' : 'text-slate-400'
              }`}
            >
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Shared
              {viewedSharedItineraries.length > 0 && (
                <span className="absolute top-1 right-1/4 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-medium bg-blue-600 text-white">
                  {viewedSharedItineraries.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('contacts')}
              className={`flex-1 flex flex-col items-center py-2 text-xs ${
                activeTab === 'contacts' ? 'text-blue-400' : 'text-slate-400'
              }`}
            >
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Contacts
            </button>
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex-1 flex flex-col items-center py-2 text-xs ${
                activeTab === 'dashboard' ? 'text-blue-400' : 'text-slate-400'
              }`}
            >
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Stats
            </button>
          </div>
        </nav>
      )}

      {showShareDialog && itinerary && (
        <ShareDialog
          itinerary={itinerary}
          onClose={() => setShowShareDialog(false)}
        />
      )}

      <Toaster />
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

export default App;
