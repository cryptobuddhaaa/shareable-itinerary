import { useState, useEffect } from 'react';
import { useItinerary } from '../hooks/useItinerary';
import { CreateItinerarySchema } from '../lib/validation';
import { z } from 'zod';
import type { Itinerary } from '../models/types';

interface EditItineraryDialogProps {
  itinerary: Itinerary;
  onClose: () => void;
}

export default function EditItineraryDialog({ itinerary, onClose }: EditItineraryDialogProps) {
  const { updateItinerary } = useItinerary();
  const [title, setTitle] = useState(itinerary.title);
  const [startDate, setStartDate] = useState(itinerary.startDate);
  const [endDate, setEndDate] = useState(itinerary.endDate);
  const [location, setLocation] = useState(itinerary.location);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSubmitting(true);

    try {
      // Validate and sanitize inputs
      const validated = CreateItinerarySchema.parse({
        title,
        startDate,
        endDate,
        location,
      });

      await updateItinerary({
        title: validated.title,
        startDate: validated.startDate,
        endDate: validated.endDate,
        location: validated.location,
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
      } else if (error instanceof Error && error.message.startsWith('DATE_CONFLICT:')) {
        const message = error.message.replace('DATE_CONFLICT:', '');
        setErrors({ form: message });
      } else if (error instanceof Error) {
        setErrors({ form: error.message });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-700">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Edit Itinerary</h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200"
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
              <p className="text-sm text-red-300 whitespace-pre-line">{errors.form}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="edit-title" className="block text-sm font-medium text-slate-300">
                Trip Title
              </label>
              <input
                type="text"
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 bg-slate-700 text-white border ${
                  errors.title ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
                }`}
                required
                disabled={isSubmitting}
              />
              {errors.title && (
                <p className="mt-1 text-sm text-red-400">{errors.title}</p>
              )}
            </div>

            <div>
              <label htmlFor="edit-location" className="block text-sm font-medium text-slate-300">
                Location
              </label>
              <input
                type="text"
                id="edit-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={500}
                className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 bg-slate-700 text-white border ${
                  errors.location ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
                }`}
                required
                disabled={isSubmitting}
              />
              {errors.location && (
                <p className="mt-1 text-sm text-red-400">{errors.location}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="edit-startDate" className="block text-sm font-medium text-slate-300">
                  Start Date
                </label>
                <input
                  type="date"
                  id="edit-startDate"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 bg-slate-700 text-white border ${
                    errors.startDate ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
                  }`}
                  required
                  disabled={isSubmitting}
                />
                {errors.startDate && (
                  <p className="mt-1 text-sm text-red-400">{errors.startDate}</p>
                )}
              </div>

              <div>
                <label htmlFor="edit-endDate" className="block text-sm font-medium text-slate-300">
                  End Date
                </label>
                <input
                  type="date"
                  id="edit-endDate"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 bg-slate-700 text-white border ${
                    errors.endDate ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
                  }`}
                  required
                  disabled={isSubmitting}
                />
                {errors.endDate && (
                  <p className="mt-1 text-sm text-red-400">{errors.endDate}</p>
                )}
              </div>
            </div>

            {itinerary.days.some((day) => day.events.length > 0) && (
              <div className="bg-yellow-900/30 border border-yellow-700 rounded-md p-4">
                <p className="text-sm text-yellow-200">
                  ⚠️ <strong>Note:</strong> This itinerary has existing events. If you change the date range to exclude any event dates, you'll need to edit or delete those events first.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium text-slate-300 border border-slate-600 rounded-md hover:bg-slate-700"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-slate-600"
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
