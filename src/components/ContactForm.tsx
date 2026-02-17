import { useState, useEffect } from 'react';
import { z } from 'zod';
import { useContacts } from '../hooks/useContacts';
import { CreateContactSchema } from '../lib/validation';

interface ContactFormProps {
  itineraryId?: string;
  eventId?: string;
  eventTitle?: string;
  lumaEventUrl?: string;
  dateMet?: string;
  onClose: () => void;
}

export default function ContactForm({
  itineraryId,
  eventId,
  eventTitle,
  lumaEventUrl,
  dateMet,
  onClose,
}: ContactFormProps) {
  const { addContact, tags, findDuplicates } = useContacts();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [projectCompany, setProjectCompany] = useState('');
  const [position, setPosition] = useState('');
  const [telegramHandle, setTelegramHandle] = useState('');
  const [email, setEmail] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSubmitting(true);

    try {
      const validated = CreateContactSchema.parse({
        firstName,
        lastName,
        projectCompany: projectCompany || undefined,
        position: position || undefined,
        telegramHandle: telegramHandle || undefined,
        email: email || undefined,
        linkedin: linkedin || undefined,
        notes: notes || undefined,
      });

      // Duplicate detection
      if (!duplicateConfirmed) {
        const dupes = findDuplicates(validated.firstName, validated.lastName, validated.telegramHandle, validated.email);
        if (dupes.length > 0) {
          const names = dupes.map((d) => `${d.firstName} ${d.lastName}${d.telegramHandle ? ` (${d.telegramHandle})` : ''}`).join(', ');
          setDuplicateWarning(`Possible duplicate: ${names}. Save anyway?`);
          setIsSubmitting(false);
          return;
        }
      }

      await addContact({
        itineraryId,
        eventId,
        eventTitle,
        lumaEventUrl,
        dateMet,
        firstName: validated.firstName,
        lastName: validated.lastName,
        projectCompany: validated.projectCompany,
        position: validated.position,
        telegramHandle: validated.telegramHandle,
        email: validated.email,
        linkedin: validated.linkedin,
        notes: validated.notes,
        tags: selectedTags,
      });

      onClose();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.issues.forEach((err) => {
          if (err.path[0]) {
            fieldErrors[err.path[0].toString()] = err.message;
          }
        });
        setErrors(fieldErrors);
      } else if (error instanceof Error) {
        const message = error.message.startsWith('LIMIT_REACHED:')
          ? error.message.replace('LIMIT_REACHED:', '')
          : error.message;
        setErrors({ form: message });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Add Contact</h2>
              {eventTitle ? (
                <p className="text-sm text-slate-300 mt-1">
                  From: <span className="font-medium">{eventTitle}</span>
                </p>
              ) : (
                <p className="text-sm text-slate-400 mt-1">Standalone contact</p>
              )}
              {dateMet && <p className="text-sm text-slate-400">{formatDate(dateMet)}</p>}
            </div>
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
            {errors.form && (
              <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded">
                {errors.form}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-slate-300 mb-1">
                  First Name *
                </label>
                <input
                  type="text"
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md bg-slate-700 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.firstName ? 'border-red-500' : 'border-slate-600'
                  }`}
                  disabled={isSubmitting}
                />
                {errors.firstName && <p className="mt-1 text-sm text-red-400">{errors.firstName}</p>}
              </div>

              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-slate-300 mb-1">
                  Last Name *
                </label>
                <input
                  type="text"
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md bg-slate-700 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.lastName ? 'border-red-500' : 'border-slate-600'
                  }`}
                  disabled={isSubmitting}
                />
                {errors.lastName && <p className="mt-1 text-sm text-red-400">{errors.lastName}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="projectCompany" className="block text-sm font-medium text-slate-300 mb-1">
                  Project/Company
                </label>
                <input
                  type="text"
                  id="projectCompany"
                  value={projectCompany}
                  onChange={(e) => setProjectCompany(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md bg-slate-700 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.projectCompany ? 'border-red-500' : 'border-slate-600'
                  }`}
                  disabled={isSubmitting}
                />
                {errors.projectCompany && <p className="mt-1 text-sm text-red-400">{errors.projectCompany}</p>}
              </div>

              <div>
                <label htmlFor="position" className="block text-sm font-medium text-slate-300 mb-1">
                  Position
                </label>
                <input
                  type="text"
                  id="position"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md bg-slate-700 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.position ? 'border-red-500' : 'border-slate-600'
                  }`}
                  disabled={isSubmitting}
                />
                {errors.position && <p className="mt-1 text-sm text-red-400">{errors.position}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="telegramHandle" className="block text-sm font-medium text-slate-300 mb-1">
                Telegram Handle
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-slate-400">@</span>
                <input
                  type="text"
                  id="telegramHandle"
                  value={telegramHandle}
                  onChange={(e) => setTelegramHandle(e.target.value)}
                  className={`w-full pl-7 pr-3 py-2 border rounded-md bg-slate-700 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.telegramHandle ? 'border-red-500' : 'border-slate-600'
                  }`}
                  placeholder="username"
                  disabled={isSubmitting}
                />
              </div>
              {errors.telegramHandle && <p className="mt-1 text-sm text-red-400">{errors.telegramHandle}</p>}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1">
                Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full px-3 py-2 border rounded-md bg-slate-700 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.email ? 'border-red-500' : 'border-slate-600'
                }`}
                disabled={isSubmitting}
              />
              {errors.email && <p className="mt-1 text-sm text-red-400">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="linkedin" className="block text-sm font-medium text-slate-300 mb-1">
                LinkedIn
              </label>
              <input
                type="text"
                id="linkedin"
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
                className={`w-full px-3 py-2 border rounded-md bg-slate-700 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.linkedin ? 'border-red-500' : 'border-slate-600'
                }`}
                placeholder="hsuchuanli or https://linkedin.com/in/hsuchuanli/"
                disabled={isSubmitting}
              />
              {errors.linkedin && <p className="mt-1 text-sm text-red-400">{errors.linkedin}</p>}
            </div>

            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-slate-300 mb-1">
                Notes
                <span className="text-slate-500 text-xs ml-1">({notes.length}/100)</span>
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={100}
                rows={2}
                className={`w-full px-3 py-2 border rounded-md bg-slate-700 text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.notes ? 'border-red-500' : 'border-slate-600'
                }`}
                disabled={isSubmitting}
                placeholder="Any additional notes about this contact..."
              />
              {errors.notes && <p className="mt-1 text-sm text-red-400">{errors.notes}</p>}
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Tags <span className="text-slate-500 text-xs">({selectedTags.length}/3)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const isSelected = selectedTags.includes(tag.name);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedTags(selectedTags.filter((t) => t !== tag.name));
                          } else if (selectedTags.length < 3) {
                            setSelectedTags([...selectedTags, tag.name]);
                          }
                        }}
                        className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                          isSelected
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'border-slate-600 text-slate-300 hover:border-slate-500'
                        } ${!isSelected && selectedTags.length >= 3 ? 'opacity-40 cursor-not-allowed' : ''}`}
                        disabled={!isSelected && selectedTags.length >= 3}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Duplicate warning */}
            {duplicateWarning && (
              <div className="bg-yellow-900/30 border border-yellow-700 text-yellow-300 px-4 py-3 rounded text-sm">
                <p>{duplicateWarning}</p>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDuplicateConfirmed(true);
                      setDuplicateWarning(null);
                    }}
                    className="px-2 py-1 text-xs bg-yellow-700 text-white rounded hover:bg-yellow-600"
                  >
                    Save Anyway
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuplicateWarning(null)}
                    className="px-2 py-1 text-xs border border-yellow-700 text-yellow-300 rounded hover:bg-yellow-900/50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm border border-slate-600 rounded-md text-slate-300 hover:bg-slate-700"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Adding...' : 'Add Contact'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
