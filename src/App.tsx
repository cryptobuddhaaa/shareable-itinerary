import { useEffect, useState } from 'react';
import { useItinerary } from './hooks/useItinerary';
import { shareService } from './services/shareService';
import ItineraryForm from './components/ItineraryForm';
import ItineraryTimeline from './components/ItineraryTimeline';
import ShareDialog from './components/ShareDialog';

function App() {
  const { itinerary, loadItinerary } = useItinerary();
  const [showShareDialog, setShowShareDialog] = useState(false);

  useEffect(() => {
    // Load itinerary from URL if present
    const urlItinerary = shareService.loadFromUrl();
    if (urlItinerary) {
      loadItinerary(urlItinerary);
    }
  }, [loadItinerary]);

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
        {!itinerary ? (
          <div className="max-w-2xl mx-auto">
            <ItineraryForm />
          </div>
        ) : (
          <ItineraryTimeline />
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
