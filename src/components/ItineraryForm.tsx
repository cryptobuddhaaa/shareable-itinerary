import { useState } from 'react';
import { useItinerary } from '../hooks/useItinerary';
import { CreateItinerarySchema } from '../lib/validation';
import { z } from 'zod';

export default function ItineraryForm() {
  const { createItinerary } = useItinerary();
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      // Validate and sanitize inputs
      const validated = CreateItinerarySchema.parse({
        title,
        startDate,
        endDate,
        location,
      });

      await createItinerary(validated.title, validated.startDate, validated.endDate, validated.location);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.issues.forEach((err) => {
          const field = err.path[0] as string;
          fieldErrors[field] = err.message;
        });
        setErrors(fieldErrors);
      } else if (error instanceof Error && error.message.startsWith('LIMIT_REACHED:')) {
        const message = error.message.replace('LIMIT_REACHED:', '');
        setErrors({ form: message });
      } else if (error instanceof Error) {
        setErrors({ form: error.message });
      }
    }
  };

  return (
    <div className="bg-slate-800 shadow rounded-lg p-6">
      <h2 className="text-2xl font-semibold text-white mb-6">Create New Itinerary</h2>
      {errors.form && (
        <div className="mb-4 bg-red-900/30 border border-red-700 rounded-md p-4">
          <p className="text-sm text-red-300">{errors.form}</p>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-slate-300">
            Trip Title
          </label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Hong Kong Business Trip"
            maxLength={200}
            className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 bg-slate-700 text-white placeholder-slate-400 border ${
              errors.title ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
            }`}
            required
          />
          {errors.title && (
            <p className="mt-1 text-sm text-red-400">{errors.title}</p>
          )}
        </div>

        <div>
          <label htmlFor="location" className="block text-sm font-medium text-slate-300">
            Location
          </label>
          <input
            type="text"
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g., Hong Kong"
            maxLength={500}
            className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 bg-slate-700 text-white placeholder-slate-400 border ${
              errors.location ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
            }`}
            required
          />
          {errors.location && (
            <p className="mt-1 text-sm text-red-400">{errors.location}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="startDate" className="block text-sm font-medium text-slate-300">
              Start Date
            </label>
            <input
              type="date"
              id="startDate"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 bg-slate-700 text-white border ${
                errors.startDate ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
              }`}
              required
            />
            {errors.startDate && (
              <p className="mt-1 text-sm text-red-400">{errors.startDate}</p>
            )}
          </div>

          <div>
            <label htmlFor="endDate" className="block text-sm font-medium text-slate-300">
              End Date
            </label>
            <input
              type="date"
              id="endDate"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
              className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm px-3 py-2 bg-slate-700 text-white border ${
                errors.endDate ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
              }`}
              required
            />
            {errors.endDate && (
              <p className="mt-1 text-sm text-red-400">{errors.endDate}</p>
            )}
          </div>
        </div>

        <button
          type="submit"
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-blue-500"
        >
          Create Itinerary
        </button>
      </form>
    </div>
  );
}
