import { useState } from 'react';
import { useItinerary, generateEventId } from '../hooks/useItinerary';
import { lumaService } from '../services/lumaService';
import { mapsService } from '../services/mapsService';
import type { ItineraryDay, ItineraryEvent, EventType } from '../models/types';

interface EventFormProps {
  day: ItineraryDay;
  onClose: () => void;
}

export default function EventForm({ day, onClose }: EventFormProps) {
  const { addEvent } = useItinerary();
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [eventType, setEventType] = useState<EventType>('meeting');
  const [lumaUrl, setLumaUrl] = useState('');
  const [goals, setGoals] = useState('');
  const [isLoadingLuma, setIsLoadingLuma] = useState(false);
  const [lumaError, setLumaError] = useState('');
  const [lumaEventDate, setLumaEventDate] = useState<string | null>(null);

  const handleFetchFromLuma = async () => {
    if (!lumaUrl || !lumaService.isLumaUrl(lumaUrl)) {
      setLumaError('Please enter a valid Luma URL');
      return;
    }

    setIsLoadingLuma(true);
    setLumaError('');

    try {
      const eventData = await lumaService.fetchEventData(lumaUrl);

      if (eventData) {
        // Validate that Luma event date matches the selected day
        if (eventData.startTime) {
          const lumaEventStart = new Date(eventData.startTime);
          const lumaDateStr = lumaEventStart.toISOString().split('T')[0]; // Get YYYY-MM-DD

          // Check if Luma event date matches the day we're adding to
          if (lumaDateStr !== day.date) {
            const lumaDateFormatted = new Date(lumaDateStr).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });
            const dayDateFormatted = new Date(day.date).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });

            setLumaError(`⚠️ Date mismatch! This Luma event is scheduled for ${lumaDateFormatted}, but you're trying to add it to ${dayDateFormatted}. Please select the correct date.`);
            setLumaEventDate(lumaDateStr);
            setIsLoadingLuma(false);
            return;
          }

          setLumaEventDate(lumaDateStr);
        }

        // Auto-fill form with fetched data
        if (eventData.title) setTitle(eventData.title);
        if (eventData.location.name) setLocationName(eventData.location.name);
        if (eventData.location.address) setLocationAddress(eventData.location.address);

        // Parse times if available
        if (eventData.startTime) {
          const start = new Date(eventData.startTime);
          setStartTime(start.toTimeString().slice(0, 5));
        }
        if (eventData.endTime) {
          const end = new Date(eventData.endTime);
          setEndTime(end.toTimeString().slice(0, 5));
        }

        setLumaError('');
      } else {
        setLumaError('Could not auto-fetch event data. Please fill manually. (Note: CORS restrictions may prevent auto-fetch)');
      }
    } catch (error) {
      console.error('Luma fetch error:', error);

      // Check if it's the dev mode API unavailability error
      if (error instanceof Error && error.message === 'DEV_MODE_NO_API') {
        setLumaError('⚠️ Luma auto-fetch only works when deployed to Vercel. For now, please fill in details manually or run "vercel dev" instead of "npm run dev".');
      } else {
        setLumaError('Failed to fetch event data. Please fill in details manually.');
      }
    } finally {
      setIsLoadingLuma(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !startTime || !endTime || !locationName) return;

    // Validate Luma event date matches the selected day
    if (lumaUrl && lumaEventDate && lumaEventDate !== day.date) {
      setLumaError('⚠️ Cannot add this Luma event to this date. The event date does not match.');
      return;
    }

    // Generate Google Maps URL for the location
    const location = {
      name: locationName,
      address: locationAddress,
    };
    const mapsUrl = mapsService.generateMapsUrl(location);

    const event: ItineraryEvent = {
      id: generateEventId(),
      title,
      startTime: `${day.date}T${startTime}`,
      endTime: `${day.date}T${endTime}`,
      location: {
        name: locationName,
        address: locationAddress,
        mapsUrl,
      },
      eventType,
      lumaEventUrl: lumaUrl || undefined,
      goals: goals ? goals.split(',').map(g => g.trim()) : [],
      notes: [],
    };

    try {
      await addEvent(day.date, event);
      onClose();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('LIMIT_REACHED:')) {
        const message = error.message.replace('LIMIT_REACHED:', '');
        setLumaError(message);
      } else if (error instanceof Error) {
        setLumaError(error.message);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white">Add Event</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-slate-300">
              Event Title
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Conference Keynote"
              className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="startTime" className="block text-sm font-medium text-slate-300">
                Start Time
              </label>
              <input
                type="time"
                id="startTime"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
                required
              />
            </div>

            <div>
              <label htmlFor="endTime" className="block text-sm font-medium text-slate-300">
                End Time
              </label>
              <input
                type="time"
                id="endTime"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="eventType" className="block text-sm font-medium text-slate-300">
              Event Type
            </label>
            <select
              id="eventType"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
              className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
            >
              <option value="meeting">Meeting</option>
              <option value="activity">Activity</option>
              <option value="meal">Meal</option>
              <option value="travel">Travel</option>
              <option value="buffer">Buffer</option>
              <option value="accommodation">Accommodation</option>
              <option value="side-event">Side Event</option>
              <option value="main-conference">Main Conference</option>
            </select>
          </div>

          <div>
            <label htmlFor="locationName" className="block text-sm font-medium text-slate-300">
              Location Name
            </label>
            <input
              type="text"
              id="locationName"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder="e.g., Hong Kong Convention Center"
              className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
              required
            />
          </div>

          <div>
            <label htmlFor="locationAddress" className="block text-sm font-medium text-slate-300">
              Location Address (Optional)
            </label>
            <input
              type="text"
              id="locationAddress"
              value={locationAddress}
              onChange={(e) => setLocationAddress(e.target.value)}
              placeholder="e.g., 1 Expo Dr, Wan Chai"
              className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
            />
          </div>

          <div>
            <label htmlFor="lumaUrl" className="block text-sm font-medium text-slate-300">
              Luma Event URL (Optional)
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type="url"
                id="lumaUrl"
                value={lumaUrl}
                onChange={(e) => {
                  setLumaUrl(e.target.value);
                  setLumaError('');
                  setLumaEventDate(null); // Clear date validation when URL changes
                }}
                placeholder="https://luma.com/..."
                className="flex-1 rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
              />
              <button
                type="button"
                onClick={handleFetchFromLuma}
                disabled={isLoadingLuma || !lumaUrl}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-purple-500 disabled:bg-slate-600 disabled:cursor-not-allowed min-w-[100px] justify-center"
              >
                {isLoadingLuma ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Auto-fill
                  </>
                )}
              </button>
            </div>
            {lumaError && (
              <p className="mt-2 text-sm text-yellow-600 bg-yellow-50 p-2 rounded border border-yellow-200">
                {lumaError}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-400">
              📱 Mobile-friendly: Paste Luma link and tap Auto-fill to fetch event details
            </p>
          </div>

          <div>
            <label htmlFor="goals" className="block text-sm font-medium text-slate-300">
              Goals (Optional, comma-separated)
            </label>
            <input
              type="text"
              id="goals"
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              placeholder="e.g., 5-8 business cards, Meet VCs"
              className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="flex-1 flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-blue-500"
            >
              Add Event
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 flex justify-center py-2 px-4 border border-slate-600 rounded-md shadow-sm text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-blue-500"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
