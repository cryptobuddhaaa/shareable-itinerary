import { useState, useEffect } from 'react';
import { useItinerary } from '../hooks/useItinerary';
import { CreateEventSchema } from '../lib/validation';
import { z } from 'zod';
import { lumaService } from '../services/lumaService';
import { mapsService } from '../services/mapsService';
import type { ItineraryEvent, EventType } from '../models/types';

interface EditEventDialogProps {
  event: ItineraryEvent;
  dayDate: string;
  onClose: () => void;
}

export default function EditEventDialog({ event, dayDate, onClose }: EditEventDialogProps) {
  const { updateEvent } = useItinerary();

  // Extract time from ISO datetime
  const startTime = event.startTime?.split('T')[1]?.slice(0, 5) || '';
  const endTime = event.endTime?.split('T')[1]?.slice(0, 5) || '';

  const [title, setTitle] = useState(event.title);
  const [startTimeInput, setStartTimeInput] = useState(startTime);
  const [endTimeInput, setEndTimeInput] = useState(endTime);
  const [locationName, setLocationName] = useState(event.location.name);
  const [locationAddress, setLocationAddress] = useState(event.location.address || '');
  const [eventType, setEventType] = useState<EventType>(event.eventType);
  const [lumaUrl, setLumaUrl] = useState(event.lumaEventUrl || '');
  const [goals, setGoals] = useState(event.goals?.join(', ') || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingLuma, setIsLoadingLuma] = useState(false);
  const [lumaError, setLumaError] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
        // Validate date matches
        if (eventData.startTime) {
          const lumaEventStart = new Date(eventData.startTime);
          const lumaDateStr = lumaEventStart.toISOString().split('T')[0];

          if (lumaDateStr !== dayDate) {
            const lumaDateFormatted = new Date(lumaDateStr).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });
            const dayDateFormatted = new Date(dayDate).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });

            setLumaError(`⚠️ Date mismatch! This Luma event is scheduled for ${lumaDateFormatted}, but this event is on ${dayDateFormatted}.`);
            setIsLoadingLuma(false);
            return;
          }
        }

        // Auto-fill form
        if (eventData.title) setTitle(eventData.title);
        if (eventData.location.name) setLocationName(eventData.location.name);
        if (eventData.location.address) setLocationAddress(eventData.location.address);

        if (eventData.startTime) {
          const start = new Date(eventData.startTime);
          setStartTimeInput(start.toTimeString().slice(0, 5));
        }
        if (eventData.endTime) {
          const end = new Date(eventData.endTime);
          setEndTimeInput(end.toTimeString().slice(0, 5));
        }

        setLumaError('');
      }
    } catch (error) {
      console.error('Luma fetch error:', error);
      if (error instanceof Error && error.message === 'DEV_MODE_NO_API') {
        setLumaError('⚠️ Luma auto-fetch only works when deployed to Vercel.');
      } else {
        setLumaError('Failed to fetch event data. Please fill in details manually.');
      }
    } finally {
      setIsLoadingLuma(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSubmitting(true);

    try {
      // Validate inputs
      const validated = CreateEventSchema.parse({
        title,
        startTime: `${dayDate}T${startTimeInput}`,
        endTime: `${dayDate}T${endTimeInput}`,
        locationName,
        locationAddress,
        eventType,
        goals,
        lumaEventUrl: lumaUrl || undefined,
      });

      // Generate Google Maps URL
      const location = {
        name: validated.locationName,
        address: validated.locationAddress,
      };
      const mapsUrl = mapsService.generateMapsUrl(location);

      await updateEvent(event.id, {
        title: validated.title,
        startTime: validated.startTime,
        endTime: validated.endTime,
        location: {
          name: validated.locationName,
          address: validated.locationAddress,
          mapsUrl,
        },
        eventType: validated.eventType,
        lumaEventUrl: validated.lumaEventUrl,
        goals: validated.goals ? validated.goals.split(',').map(g => g.trim()) : [],
      });

      onClose();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.issues.forEach((err) => {
          const field = err.path[0] as string;
          fieldErrors[field] = err.message;
        });
        setErrors(fieldErrors);
      } else if (error instanceof Error) {
        setErrors({ form: error.message });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-700">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Edit Event</h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-300"
              disabled={isSubmitting}
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4">
          {errors.form && (
            <div className="mb-4 bg-red-900/30 border border-red-700 rounded-md p-4">
              <p className="text-sm text-red-300">{errors.form}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="edit-event-title" className="block text-sm font-medium text-slate-300">
                Event Title
              </label>
              <input
                type="text"
                id="edit-event-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
                required
                disabled={isSubmitting}
              />
              {errors.title && <p className="mt-1 text-sm text-red-400">{errors.title}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-startTime" className="block text-sm font-medium text-slate-300">
                  Start Time
                </label>
                <input
                  type="time"
                  id="edit-startTime"
                  value={startTimeInput}
                  onChange={(e) => setStartTimeInput(e.target.value)}
                  className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
                  required
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label htmlFor="edit-endTime" className="block text-sm font-medium text-slate-300">
                  End Time
                </label>
                <input
                  type="time"
                  id="edit-endTime"
                  value={endTimeInput}
                  onChange={(e) => setEndTimeInput(e.target.value)}
                  className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div>
              <label htmlFor="edit-eventType" className="block text-sm font-medium text-slate-300">
                Event Type
              </label>
              <select
                id="edit-eventType"
                value={eventType}
                onChange={(e) => setEventType(e.target.value as EventType)}
                className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
                disabled={isSubmitting}
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
              <label htmlFor="edit-locationName" className="block text-sm font-medium text-slate-300">
                Location Name
              </label>
              <input
                type="text"
                id="edit-locationName"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                maxLength={200}
                className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
                required
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="edit-locationAddress" className="block text-sm font-medium text-slate-300">
                Location Address (Optional)
              </label>
              <input
                type="text"
                id="edit-locationAddress"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                maxLength={500}
                className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="edit-lumaUrl" className="block text-sm font-medium text-slate-300">
                Luma Event URL (Optional)
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  type="url"
                  id="edit-lumaUrl"
                  value={lumaUrl}
                  onChange={(e) => {
                    setLumaUrl(e.target.value);
                    setLumaError('');
                  }}
                  className="flex-1 rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={handleFetchFromLuma}
                  disabled={isLoadingLuma || !lumaUrl || isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-slate-600"
                >
                  {isLoadingLuma ? 'Fetching...' : 'Auto-fetch'}
                </button>
              </div>
              {lumaError && (
                <p className="mt-2 text-sm text-yellow-600 bg-yellow-50 p-2 rounded border border-yellow-200">
                  {lumaError}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="edit-goals" className="block text-sm font-medium text-slate-300">
                Goals (comma-separated, optional)
              </label>
              <input
                type="text"
                id="edit-goals"
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                maxLength={1000}
                className="mt-1 block w-full rounded-md border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 sm:text-sm px-3 py-2 border bg-slate-700 text-white"
                placeholder="e.g., Network with investors, Get feedback"
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-600 rounded-md hover:bg-slate-700"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-400"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
