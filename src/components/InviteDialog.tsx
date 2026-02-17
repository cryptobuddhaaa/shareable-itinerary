import { useState, useMemo, useEffect } from 'react';
import { useContacts } from '../hooks/useContacts';
import { useItinerary } from '../hooks/useItinerary';
import { toast } from './Toast';
import type { Contact } from '../models/types';

interface InviteDialogProps {
  onClose: () => void;
}

type Step = 'select' | 'compose' | 'send';

const DEFAULT_TEMPLATE = `Hey {firstName}! It was great meeting you{eventMention}. Would love to stay in touch — let me know if you're up for a quick chat sometime!`;

function personalizeMessage(template: string, contact: Contact): string {
  const eventMention = contact.eventTitle ? ` at ${contact.eventTitle}` : '';
  return template
    .replace(/\{firstName\}/g, contact.firstName)
    .replace(/\{lastName\}/g, contact.lastName || '')
    .replace(/\{fullName\}/g, `${contact.firstName} ${contact.lastName || ''}`.trim())
    .replace(/\{company\}/g, contact.projectCompany || '')
    .replace(/\{eventTitle\}/g, contact.eventTitle || '')
    .replace(/\{eventMention\}/g, eventMention);
}

export default function InviteDialog({ onClose }: InviteDialogProps) {
  const { contacts, updateContact } = useContacts();
  const { itineraries } = useItinerary();

  const [step, setStep] = useState<Step>('select');
  const [filterItineraryId, setFilterItineraryId] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [sendIndex, setSendIndex] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Only contacts with telegram handles
  const eligibleContacts = useMemo(() => {
    let filtered = contacts.filter((c) => c.telegramHandle);
    if (filterItineraryId !== 'all') {
      filtered = filtered.filter((c) => c.itineraryId === filterItineraryId);
    }
    return filtered;
  }, [contacts, filterItineraryId]);

  const selectedContacts = useMemo(
    () => contacts.filter((c) => selectedIds.has(c.id)),
    [contacts, selectedIds]
  );

  const toggleContact = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === eligibleContacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligibleContacts.map((c) => c.id)));
    }
  };

  const currentContact = selectedContacts[sendIndex];
  const currentMessage = currentContact ? personalizeMessage(template, currentContact) : '';

  const handleCopyAndOpen = async () => {
    if (!currentContact) return;
    try {
      await navigator.clipboard.writeText(currentMessage);
      toast.info('Message copied to clipboard');
    } catch {
      toast.error('Failed to copy. Please copy manually.');
    }

    const handle = currentContact.telegramHandle?.replace('@', '');
    if (handle) {
      window.open(`https://t.me/${handle}`, '_blank');
    }
  };

  const handleMarkSentAndNext = async () => {
    if (!currentContact) return;
    try {
      await updateContact(currentContact.id, { lastContactedAt: new Date().toISOString() });
    } catch {
      // Non-blocking
    }
    if (sendIndex + 1 < selectedContacts.length) {
      setSendIndex(sendIndex + 1);
    } else {
      toast.info(`Done! Reached out to ${selectedContacts.length} contact${selectedContacts.length !== 1 ? 's' : ''}.`);
      onClose();
    }
  };

  const handleSkip = () => {
    if (sendIndex + 1 < selectedContacts.length) {
      setSendIndex(sendIndex + 1);
    } else {
      toast.info('Done!');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">
            {step === 'select' && 'Select Contacts'}
            {step === 'compose' && 'Compose Message'}
            {step === 'send' && `Sending ${sendIndex + 1}/${selectedContacts.length}`}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1"
            aria-label="Close dialog"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'select' && (
            <div>
              {/* Filter by itinerary */}
              {itineraries.length > 0 && (
                <div className="mb-4">
                  <label className="block text-sm text-slate-400 mb-1">Filter by trip</label>
                  <select
                    value={filterItineraryId}
                    onChange={(e) => {
                      setFilterItineraryId(e.target.value);
                      setSelectedIds(new Set());
                    }}
                    className="block w-full px-3 py-2 border border-slate-600 rounded-md bg-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All trips</option>
                    {itineraries.map((it) => (
                      <option key={it.id} value={it.id}>{it.title}</option>
                    ))}
                  </select>
                </div>
              )}

              {eligibleContacts.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">
                  No contacts with Telegram handles found.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-slate-400">
                      {eligibleContacts.length} contact{eligibleContacts.length !== 1 ? 's' : ''} with Telegram
                    </span>
                    <button
                      onClick={toggleAll}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      {selectedIds.size === eligibleContacts.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {eligibleContacts.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-3 p-2 rounded hover:bg-slate-700/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleContact(c.id)}
                          className="rounded border-slate-500 text-blue-500 focus:ring-blue-500 bg-slate-700"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-white">
                            {c.firstName} {c.lastName}
                          </span>
                          {c.projectCompany && (
                            <span className="text-xs text-slate-400 ml-2">{c.projectCompany}</span>
                          )}
                        </div>
                        <span className="text-xs text-slate-500">{c.telegramHandle}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'compose' && (
            <div>
              <p className="text-sm text-slate-400 mb-3">
                Write your message template. Available variables:
              </p>
              <div className="flex flex-wrap gap-1 mb-3">
                {['{firstName}', '{lastName}', '{fullName}', '{company}', '{eventTitle}', '{eventMention}'].map((v) => (
                  <button
                    key={v}
                    onClick={() => setTemplate((t) => t + v)}
                    className="px-2 py-0.5 text-xs bg-slate-700 text-blue-400 rounded border border-slate-600 hover:bg-slate-600"
                  >
                    {v}
                  </button>
                ))}
              </div>
              <textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={5}
                className="block w-full px-3 py-2 border border-slate-600 rounded-md bg-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              {selectedContacts.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-slate-400 mb-1">Preview (for {selectedContacts[0].firstName}):</p>
                  <div className="p-3 bg-slate-900 rounded text-sm text-slate-300 whitespace-pre-wrap">
                    {personalizeMessage(template, selectedContacts[0])}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'send' && currentContact && (
            <div>
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-white font-medium">
                    {currentContact.firstName} {currentContact.lastName}
                  </span>
                  <span className="text-xs text-slate-400">{currentContact.telegramHandle}</span>
                </div>
                {currentContact.projectCompany && (
                  <p className="text-xs text-slate-400">{currentContact.projectCompany}</p>
                )}
              </div>

              <div className="p-3 bg-slate-900 rounded text-sm text-slate-300 whitespace-pre-wrap mb-4">
                {currentMessage}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={handleCopyAndOpen}
                  className="w-full px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Copy Message & Open DM
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={handleMarkSentAndNext}
                    className="flex-1 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    {sendIndex + 1 < selectedContacts.length ? 'Sent! Next' : 'Sent! Done'}
                  </button>
                  <button
                    onClick={handleSkip}
                    className="px-3 py-1.5 border border-slate-600 text-slate-300 text-sm rounded-md hover:bg-slate-700"
                  >
                    Skip
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Progress</span>
                  <span>{sendIndex + 1} / {selectedContacts.length}</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${((sendIndex + 1) / selectedContacts.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'send' && (
          <div className="flex justify-between p-4 border-t border-slate-700">
            <button
              onClick={step === 'select' ? onClose : () => setStep('select')}
              className="px-3 py-1.5 text-sm text-slate-300 hover:text-white"
            >
              {step === 'select' ? 'Cancel' : 'Back'}
            </button>
            <button
              onClick={() => {
                if (step === 'select') {
                  if (selectedIds.size === 0) {
                    toast.error('Select at least one contact.');
                    return;
                  }
                  setStep('compose');
                } else if (step === 'compose') {
                  if (!template.trim()) {
                    toast.error('Message template cannot be empty.');
                    return;
                  }
                  setSendIndex(0);
                  setStep('send');
                }
              }}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
              disabled={step === 'select' && selectedIds.size === 0}
            >
              {step === 'select' ? `Next (${selectedIds.size} selected)` : 'Start Sending'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
