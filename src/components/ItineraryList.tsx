import { useState } from 'react';
import { useItinerary } from '../hooks/useItinerary';
import ShareDialog from './ShareDialog';
import EditItineraryDialog from './EditItineraryDialog';
import type { Itinerary } from '../models/types';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

export default function ItineraryList() {
  const { itineraries, currentItineraryId, selectItinerary, deleteItinerary } = useItinerary();
  const [shareItinerary, setShareItinerary] = useState<Itinerary | null>(null);
  const [editItinerary, setEditItinerary] = useState<Itinerary | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const { confirm, dialogProps } = useConfirmDialog();

  if (itineraries.length === 0) {
    return null;
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="bg-slate-800 shadow rounded-lg p-6 mb-6">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between mb-4 hover:bg-slate-700 p-2 rounded-lg transition-colors"
      >
        <h2 className="text-lg font-semibold text-white">My Itineraries</h2>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${
            isExpanded ? 'transform rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isExpanded && (
        <div className="space-y-2">
        {itineraries.map((itinerary) => {
          const isActive = itinerary.id === currentItineraryId;
          return (
            <div
              key={itinerary.id}
              className={`flex items-center justify-between p-3 rounded-lg border-2 ${
                isActive
                  ? 'border-blue-500 bg-blue-900/30'
                  : 'border-slate-700 bg-slate-800 hover:border-slate-600'
              }`}
            >
              <button
                onClick={() => selectItinerary(itinerary.id)}
                className="flex-1 text-left"
              >
                <div className="font-medium text-white">{itinerary.title}</div>
                <div className="text-sm text-slate-300">
                  {itinerary.location} · {formatDate(itinerary.startDate)} - {formatDate(itinerary.endDate)}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {itinerary.days.reduce((total, day) => total + day.events.length, 0)} events
                </div>
              </button>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditItinerary(itinerary);
                  }}
                  className="text-slate-400 hover:text-slate-200 p-2"
                  title="Edit itinerary"
                  aria-label="Edit itinerary"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShareItinerary(itinerary);
                  }}
                  className="text-blue-400 hover:text-blue-300 p-2"
                  title="Share itinerary"
                  aria-label="Share itinerary"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const confirmed = await confirm({
                      title: `Delete "${itinerary.title}"?`,
                      message: 'This itinerary and all its events will be permanently deleted.',
                      confirmLabel: 'Delete',
                      variant: 'danger',
                    });
                    if (confirmed) deleteItinerary(itinerary.id);
                  }}
                  className="text-red-400 hover:text-red-300 p-2"
                  title="Delete itinerary"
                  aria-label="Delete itinerary"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
        </div>
      )}

      {shareItinerary && (
        <ShareDialog
          itinerary={shareItinerary}
          onClose={() => setShareItinerary(null)}
        />
      )}

      {editItinerary && (
        <EditItineraryDialog
          itinerary={editItinerary}
          onClose={() => setEditItinerary(null)}
        />
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
