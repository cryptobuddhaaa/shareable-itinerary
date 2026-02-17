import { useState, useEffect } from 'react';
import { z } from 'zod';
import { useContacts } from '../hooks/useContacts';
import { useItinerary } from '../hooks/useItinerary';
import { CreateContactSchema } from '../lib/validation';
import type { Contact, ContactNote, ItineraryEvent } from '../models/types';
import { toast } from './Toast';

interface EditContactDialogProps {
  contact: Contact;
  onClose: () => void;
}

export default function EditContactDialog({ contact, onClose }: EditContactDialogProps) {
  const { updateContact, tags, fetchNotes, addNote, deleteNote } = useContacts();
  const { itineraries } = useItinerary();
  const [firstName, setFirstName] = useState(contact.firstName);
  const [lastName, setLastName] = useState(contact.lastName);
  const [projectCompany, setProjectCompany] = useState(contact.projectCompany || '');
  const [position, setPosition] = useState(contact.position || '');
  const [telegramHandle, setTelegramHandle] = useState(contact.telegramHandle || '');
  const [email, setEmail] = useState(contact.email || '');
  const [linkedin, setLinkedin] = useState(contact.linkedin || '');
  const [notes, setNotes] = useState(contact.notes || '');
  const [selectedTags, setSelectedTags] = useState<string[]>(contact.tags || []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLinkEvent, setShowLinkEvent] = useState(false);
  const [selectedItineraryId, setSelectedItineraryId] = useState(contact.itineraryId || '');
  const [selectedEventId, setSelectedEventId] = useState(contact.eventId || '');

  // Notes timeline
  const [contactNotes, setContactNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [notesLoading, setNotesLoading] = useState(true);

  useEffect(() => {
    fetchNotes(contact.id).then((n) => {
      setContactNotes(n);
      setNotesLoading(false);
    }).catch(() => setNotesLoading(false));
  }, [contact.id, fetchNotes]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Get events for the selected itinerary
  const selectedItinerary = itineraries.find((it) => it.id === selectedItineraryId);
  const availableEvents: (ItineraryEvent & { dayDate: string })[] = [];
  if (selectedItinerary) {
    for (const day of selectedItinerary.days) {
      for (const event of day.events) {
        availableEvents.push({ ...event, dayDate: day.date });
      }
    }
  }

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

      const updates: Partial<Contact> = {
        firstName: validated.firstName,
        lastName: validated.lastName,
        projectCompany: validated.projectCompany,
        position: validated.position,
        telegramHandle: validated.telegramHandle,
        email: validated.email,
        linkedin: validated.linkedin,
        notes: validated.notes,
        tags: selectedTags,
      };

      // Include event linking updates if changed
      if (selectedEventId && selectedEventId !== contact.eventId) {
        const linkedEvent = availableEvents.find((e) => e.id === selectedEventId);
        if (linkedEvent) {
          updates.itineraryId = selectedItineraryId;
          updates.eventId = selectedEventId;
          updates.eventTitle = linkedEvent.title;
          updates.dateMet = linkedEvent.dayDate;
          updates.lumaEventUrl = linkedEvent.lumaEventUrl;
        }
      } else if (!selectedEventId && contact.eventId) {
        // Unlink event
        updates.itineraryId = undefined;
        updates.eventId = undefined;
        updates.eventTitle = undefined;
        updates.dateMet = undefined;
        updates.lumaEventUrl = undefined;
      }

      await updateContact(contact.id, updates);

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
        setErrors({ form: error.message });
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
              <h2 className="text-lg font-semibold text-white">Edit Contact</h2>
              {contact.eventTitle ? (
                <p className="text-sm text-slate-300 mt-1">
                  From: <span className="font-medium">{contact.eventTitle}</span>
                </p>
              ) : (
                <p className="text-sm text-slate-400 mt-1">Standalone contact</p>
              )}
              {contact.dateMet && <p className="text-sm text-slate-400">{formatDate(contact.dateMet)}</p>}
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

            {/* Link to Event section */}
            <div className="border-t border-slate-700 pt-4">
              {!showLinkEvent && !contact.eventId ? (
                <button
                  type="button"
                  onClick={() => setShowLinkEvent(true)}
                  className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  Link to an event
                </button>
              ) : showLinkEvent || contact.eventId ? (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-300">
                    Linked Event
                  </label>
                  <select
                    value={selectedItineraryId}
                    onChange={(e) => {
                      setSelectedItineraryId(e.target.value);
                      setSelectedEventId('');
                    }}
                    className="block w-full px-3 py-2 border border-slate-600 rounded-md text-sm bg-slate-700 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    disabled={isSubmitting}
                  >
                    <option value="">No itinerary</option>
                    {itineraries.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.title} ({it.location})
                      </option>
                    ))}
                  </select>
                  {selectedItineraryId && availableEvents.length > 0 && (
                    <select
                      value={selectedEventId}
                      onChange={(e) => setSelectedEventId(e.target.value)}
                      className="block w-full px-3 py-2 border border-slate-600 rounded-md text-sm bg-slate-700 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      disabled={isSubmitting}
                    >
                      <option value="">No event</option>
                      {availableEvents.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {new Date(ev.dayDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {ev.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : null}
            </div>

            {/* Notes Timeline */}
            <div className="border-t border-slate-700 pt-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Notes Timeline <span className="text-slate-500 text-xs">({contactNotes.length}/10)</span>
              </label>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!newNote.trim() || contactNotes.length >= 10) return;
                      try {
                        const note = await addNote(contact.id, newNote);
                        setContactNotes([note, ...contactNotes]);
                        setNewNote('');
                      } catch {
                        toast.error('Failed to add note');
                      }
                    }
                  }}
                  placeholder="Add a note..."
                  maxLength={200}
                  className="flex-1 px-2 py-1 text-sm bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  disabled={contactNotes.length >= 10}
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newNote.trim() || contactNotes.length >= 10) return;
                    try {
                      const note = await addNote(contact.id, newNote);
                      setContactNotes([note, ...contactNotes]);
                      setNewNote('');
                    } catch {
                      toast.error('Failed to add note');
                    }
                  }}
                  disabled={!newNote.trim() || contactNotes.length >= 10}
                  className="px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {notesLoading ? (
                <p className="text-xs text-slate-500">Loading notes...</p>
              ) : contactNotes.length === 0 ? (
                <p className="text-xs text-slate-500">No notes yet. Add timestamped notes to track your relationship.</p>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {contactNotes.map((note) => (
                    <div key={note.id} className="flex items-start gap-2 text-sm">
                      <span className="text-xs text-slate-500 whitespace-nowrap mt-0.5">
                        {new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span className="text-slate-300 flex-1">{note.content}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await deleteNote(note.id);
                            setContactNotes(contactNotes.filter((n) => n.id !== note.id));
                          } catch {
                            toast.error('Failed to delete note');
                          }
                        }}
                        className="text-slate-500 hover:text-red-400 flex-shrink-0"
                        aria-label="Delete note"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

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
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
