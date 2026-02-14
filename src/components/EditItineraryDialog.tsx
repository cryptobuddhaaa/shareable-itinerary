import { useState } from 'react';
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
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900">Edit Itinerary</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
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
            <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
              <p className="text-sm text-red-700 whitespace-pre-line">{errors.form}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="edit-title" className="block text-sm font-medium text-gray-700">
                Trip Title
              </label>
              <input
                type="text"
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 border ${
                  errors.title ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-blue-500'
                }`}
                required
                disabled={isSubmitting}
              />
              {errors.title && (
                <p className="mt-1 text-sm text-red-600">{errors.title}</p>
              )}
            </div>

            <div>
              <label htmlFor="edit-location" className="block text-sm font-medium text-gray-700">
                Location
              </label>
              <input
                type="text"
                id="edit-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={500}
                className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 border ${
                  errors.location ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-blue-500'
                }`}
                required
                disabled={isSubmitting}
              />
              {errors.location && (
                <p className="mt-1 text-sm text-red-600">{errors.location}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="edit-startDate" className="block text-sm font-medium text-gray-700">
                  Start Date
                </label>
                <input
                  type="date"
                  id="edit-startDate"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 border ${
                    errors.startDate ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-blue-500'
                  }`}
                  required
                  disabled={isSubmitting}
                />
                {errors.startDate && (
                  <p className="mt-1 text-sm text-red-600">{errors.startDate}</p>
                )}
              </div>

              <div>
                <label htmlFor="edit-endDate" className="block text-sm font-medium text-gray-700">
                  End Date
                </label>
                <input
                  type="date"
                  id="edit-endDate"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 border ${
                    errors.endDate ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-blue-500'
                  }`}
                  required
                  disabled={isSubmitting}
                />
                {errors.endDate && (
                  <p className="mt-1 text-sm text-red-600">{errors.endDate}</p>
                )}
              </div>
            </div>

            {itinerary.days.some((day) => day.events.length > 0) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                <p className="text-sm text-yellow-800">
                  ⚠️ <strong>Note:</strong> This itinerary has existing events. If you change the date range to exclude any event dates, you'll need to edit or delete those events first.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-400"
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
