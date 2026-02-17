import { useEffect, useState } from 'react';
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

type ActiveTab = 'itinerary' | 'contacts' | 'shared';

function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { currentItinerary, itineraries, initialize, initialized, reset } = useItinerary();
  const { initialize: initializeContacts, initialized: contactsInitialized, reset: resetContacts } = useContacts();
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('itinerary');
  const [prevItineraryCount, setPrevItineraryCount] = useState(itineraries.length);
  const [sharedItinerary, setSharedItinerary] = useState<Itinerary | null>(null);
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
  }, [user, initialized, initialize, reset, contactsInitialized, initializeContacts, resetContacts]);

  // This effect is removed - we handle shared itineraries separately now

  // Close create form when a new itinerary is created
  useEffect(() => {
    if (itineraries.length > prevItineraryCount && showCreateForm) {
      setShowCreateForm(false);
    }
    setPrevItineraryCount(itineraries.length);
  }, [itineraries.length, prevItineraryCount, showCreateForm]);

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

  // If there's a shared itinerary in the URL, show it (for both logged-in and non-logged-in users)
  if (sharedItinerary) {
    return (
      <div className="min-h-screen bg-slate-900">
        <header className="bg-slate-800 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
              <div className="flex-shrink-0">
                <h1 className="text-2xl sm:text-3xl font-bold text-white">Shared Itinerary</h1>
                <p className="text-sm text-slate-300 mt-1">{sharedItinerary.title}</p>
                {sharedItinerary.createdByName && (
                  <p className="text-xs text-slate-400 mt-1">
                    Shared by {sharedItinerary.createdByName}
                  </p>
                )}
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
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="flex-shrink-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-white">Itinerary & Contact Manager</h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">All in one trip planning and networking tool</p>
            </div>
            <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-4">
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

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
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
            <div className="mb-6 -mx-4 sm:mx-0">
              <nav className="flex space-x-2 sm:space-x-4 border-b border-slate-700 overflow-x-auto px-4 sm:px-0 scrollbar-hide">
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
          </div>
        )}
      </main>

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
