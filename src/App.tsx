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

type ActiveTab = 'itinerary' | 'contacts' | 'shared';

function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { currentItinerary, itineraries, initialize, initialized, reset } = useItinerary();
  const { initialize: initializeContacts, initialized: contactsInitialized, reset: resetContacts } = useContacts();
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('itinerary');
  const [prevItineraryCount, setPrevItineraryCount] = useState(itineraries.length);
  const [sharedItinerary, setSharedItinerary] = useState<any>(null);
  const [viewedSharedItineraries, setViewedSharedItineraries] = useState<any[]>([]);
  const [selectedSharedItinerary, setSelectedSharedItinerary] = useState<any>(null);

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If there's a shared itinerary in the URL, show it (for both logged-in and non-logged-in users)
  if (sharedItinerary) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Shared Itinerary</h1>
                <p className="text-sm text-gray-600 mt-1">{sharedItinerary.title}</p>
                {sharedItinerary.createdByName && (
                  <p className="text-xs text-gray-500 mt-1">
                    Shared by {sharedItinerary.createdByName}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4">
                {user ? (
                  <>
                    <a
                      href={window.location.origin + window.location.pathname}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                      </svg>
                      Back to My Itineraries
                    </a>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900">{user?.user_metadata?.full_name || user?.email}</p>
                        <p className="text-xs text-gray-500">{user?.email}</p>
                      </div>
                      {user?.user_metadata?.avatar_url && (
                        <img
                          src={user.user_metadata.avatar_url}
                          alt="Profile"
                          className="w-10 h-10 rounded-full"
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <a
                    href={window.location.origin + window.location.pathname}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                  >
                    Create Your Own Itinerary
                  </a>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-900">
              📌 You're viewing a shared itinerary{sharedItinerary.createdByName ? ` from ${sharedItinerary.createdByName}` : ''}.
              {!user && (
                <>
                  {' '}<a href={window.location.origin + window.location.pathname} className="underline font-medium">Sign in with Google</a> to create and save your own itineraries!
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Itinerary Builder</h1>
              <p className="text-sm text-gray-600 mt-1">Plan and share your trips</p>
            </div>
            <div className="flex items-center gap-4">
              {itinerary && (
                <button
                  onClick={() => setShowShareDialog(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </button>
              )}
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{user?.user_metadata?.full_name || user?.email}</p>
                  <p className="text-xs text-gray-500">{user?.email}</p>
                </div>
                {user?.user_metadata?.avatar_url && (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt="Profile"
                    className="w-10 h-10 rounded-full"
                  />
                )}
                <button
                  onClick={signOut}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  title="Sign out"
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
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Create Your First Itinerary</h2>
              <p className="text-gray-600">Start planning your trip by creating an itinerary</p>
            </div>
            <ItineraryForm />
          </div>
        ) : (
          <div>
            <div className="mb-6">
              <nav className="flex space-x-4 border-b border-gray-200">
                <button
                  onClick={() => setActiveTab('itinerary')}
                  className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === 'itinerary'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  My Itineraries
                </button>
                <button
                  onClick={() => setActiveTab('shared')}
                  className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === 'shared'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Others' Itineraries
                  {viewedSharedItineraries.length > 0 && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {viewedSharedItineraries.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('contacts')}
                  className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === 'contacts'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
              <div className="bg-white shadow rounded-lg p-6 mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Create New Itinerary</h2>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="text-gray-500 hover:text-gray-700"
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
                    className="w-full mb-6 inline-flex items-center justify-center px-4 py-3 border-2 border-dashed border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
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
                  <div className="text-center py-12 bg-white rounded-lg shadow">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No shared itineraries yet</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      When someone shares an itinerary with you, it will appear here
                    </p>
                  </div>
                ) : (
                  <div>
                    {!selectedSharedItinerary ? (
                      <div className="space-y-4">
                        <div className="flex justify-between items-center mb-4">
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">Shared Itineraries</h2>
                            <p className="text-sm text-gray-600 mt-1">
                              Itineraries that have been shared with you
                            </p>
                          </div>
                          {viewedSharedItineraries.length > 0 && (
                            <button
                              onClick={() => {
                                if (confirm('Clear all shared itineraries from this list?')) {
                                  setViewedSharedItineraries([]);
                                  localStorage.removeItem('viewedSharedItineraries');
                                }
                              }}
                              className="text-sm text-red-600 hover:text-red-700"
                            >
                              Clear All
                            </button>
                          )}
                        </div>
                        <div className="grid gap-4">
                          {viewedSharedItineraries.map((sharedItem) => (
                            <div
                              key={sharedItem.id}
                              className="bg-white shadow rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                              onClick={() => setSelectedSharedItinerary(sharedItem)}
                            >
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <h3 className="text-lg font-semibold text-gray-900">{sharedItem.title}</h3>
                                  <p className="text-sm text-gray-600 mt-1">{sharedItem.location}</p>
                                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
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
                                  className="text-gray-400 hover:text-red-600"
                                  title="Remove from list"
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
                            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
                          >
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                            Back to list
                          </button>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                          <p className="text-sm text-blue-900">
                            📌 Viewing shared itinerary: <strong>{selectedSharedItinerary.title}</strong>
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
    </div>
  );
}

export default App;
