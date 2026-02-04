import { useEffect, useState } from 'react';
import { useItinerary } from './hooks/useItinerary';
import { shareService } from './services/shareService';
import ItineraryForm from './components/ItineraryForm';
import ItineraryList from './components/ItineraryList';
import ItineraryTimeline from './components/ItineraryTimeline';
import ShareDialog from './components/ShareDialog';

function App() {
  const { currentItinerary, itineraries, currentItineraryId, loadItinerary } = useItinerary();
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [prevItineraryCount, setPrevItineraryCount] = useState(itineraries.length);

  const itinerary = currentItinerary();

  useEffect(() => {
    // Load itinerary from URL if present
    const urlItinerary = shareService.loadFromUrl();
    if (urlItinerary) {
      loadItinerary(urlItinerary);
    }
  }, [loadItinerary]);

  // Close create form when a new itinerary is created
  useEffect(() => {
    if (itineraries.length > prevItineraryCount && showCreateForm) {
      setShowCreateForm(false);
    }
    setPrevItineraryCount(itineraries.length);
  }, [itineraries.length, prevItineraryCount, showCreateForm]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Itinerary Builder</h1>
              <p className="text-sm text-gray-600 mt-1">Plan and share your trips</p>
            </div>
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
