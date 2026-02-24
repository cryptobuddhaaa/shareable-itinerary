import { useState, useMemo, useEffect, useCallback } from 'react';
import { useContacts } from '../hooks/useContacts';
import { useItinerary } from '../hooks/useItinerary';
import { toast } from './Toast';
import { isTelegramWebApp, openTelegramLink } from '../lib/telegram';
import type { Contact } from '../models/types';

interface InviteDialogProps {
  onClose: () => void;
}

type Step = 'select' | 'compose' | 'send';

// --- Pre-set templates ---
interface MessageTemplate {
  id: string;
  name: string;
  body: string;
  builtin: boolean;
}

const BUILTIN_TEMPLATES: MessageTemplate[] = [
  {
    id: 'follow-up',
    name: 'Follow-up',
    body: `Hey {firstName}! It was great meeting you{eventMention}. Would love to stay in touch \u2014 let me know if you\u2019re up for a quick chat sometime!`,
    builtin: true,
  },
  {
    id: 'convenu-invite',
    name: 'Convenu Invite',
    body: `Hey {firstName}! Great connecting with you{eventMention}. I\u2019m using @convenubot to keep track of people I meet at events \u2014 and it lets us mint an on-chain Proof of Handshake as a soulbound NFT on Solana. Try it out and claim our handshake: https://t.me/convenubot`,
    builtin: true,
  },
  {
    id: 'quick-hello',
    name: 'Quick Hello',
    body: `Hi {firstName}! Just wanted to say it was nice meeting you{eventMention}. Hope to cross paths again soon!`,
    builtin: true,
  },
  {
    id: 'collab',
    name: 'Collaboration',
    body: `Hey {firstName}! Enjoyed our conversation{eventMention}. I think there could be some cool synergies between what you\u2019re building at {company} and what I\u2019m working on. Would you be open to a quick call this week?`,
    builtin: true,
  },
];

const CUSTOM_TEMPLATES_KEY = 'convenu_custom_templates';
const MAX_CUSTOM_TEMPLATES = 3;

function loadCustomTemplates(): MessageTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MessageTemplate[];
    return parsed.slice(0, MAX_CUSTOM_TEMPLATES);
  } catch {
    return [];
  }
}

function saveCustomTemplates(templates: MessageTemplate[]) {
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates.slice(0, MAX_CUSTOM_TEMPLATES)));
}

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
  const [template, setTemplate] = useState(BUILTIN_TEMPLATES[0].body);
  const [activeTemplateId, setActiveTemplateId] = useState<string>(BUILTIN_TEMPLATES[0].id);
  const [sendIndex, setSendIndex] = useState(0);

  // Custom template management
  const [customTemplates, setCustomTemplates] = useState<MessageTemplate[]>(loadCustomTemplates);
  const [editingCustom, setEditingCustom] = useState<{ name: string; body: string } | null>(null);

  const allTemplates = useMemo(
    () => [...BUILTIN_TEMPLATES, ...customTemplates],
    [customTemplates]
  );

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

  const selectTemplate = useCallback((t: MessageTemplate) => {
    setActiveTemplateId(t.id);
    setTemplate(t.body);
  }, []);

  const handleSaveCustomTemplate = () => {
    if (!editingCustom) return;
    const name = editingCustom.name.trim();
    const body = editingCustom.body.trim();
    if (!name || !body) {
      toast.error('Template name and message are required.');
      return;
    }
    if (customTemplates.length >= MAX_CUSTOM_TEMPLATES) {
      toast.error(`You can save up to ${MAX_CUSTOM_TEMPLATES} custom templates.`);
      return;
    }
    const newTemplate: MessageTemplate = {
      id: `custom-${Date.now()}`,
      name,
      body,
      builtin: false,
    };
    const updated = [...customTemplates, newTemplate];
    setCustomTemplates(updated);
    saveCustomTemplates(updated);
    setEditingCustom(null);
    selectTemplate(newTemplate);
    toast.success('Template saved');
  };

  const handleDeleteCustomTemplate = (id: string) => {
    const updated = customTemplates.filter((t) => t.id !== id);
    setCustomTemplates(updated);
    saveCustomTemplates(updated);
    if (activeTemplateId === id) {
      selectTemplate(BUILTIN_TEMPLATES[0]);
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
      toast.error('Failed to copy. Please copy the message manually.');
    }

    const handle = currentContact.telegramHandle?.replace('@', '');
    if (handle) {
      const dmUrl = `https://t.me/${handle}`;
      if (isTelegramWebApp()) {
        openTelegramLink(dmUrl);
      } else {
        window.open(dmUrl, '_blank');
      }
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
              {/* Template selector */}
              <label className="block text-sm text-slate-400 mb-2">Choose a template</label>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {allTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => selectTemplate(t)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      activeTemplateId === t.id
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {t.name}
                    {!t.builtin && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCustomTemplate(t.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            handleDeleteCustomTemplate(t.id);
                          }
                        }}
                        className="ml-1.5 text-slate-400 hover:text-red-400"
                        title="Delete custom template"
                      >
                        &times;
                      </span>
                    )}
                  </button>
                ))}
                {customTemplates.length < MAX_CUSTOM_TEMPLATES && !editingCustom && (
                  <button
                    onClick={() => setEditingCustom({ name: '', body: '' })}
                    className="px-2.5 py-1 text-xs rounded-full border border-dashed border-slate-500 text-slate-400 hover:text-blue-400 hover:border-blue-500 transition-colors"
                  >
                    + Custom
                  </button>
                )}
              </div>

              {/* Save custom template form */}
              {editingCustom && (
                <div className="mb-3 p-3 border border-blue-700/50 bg-blue-900/10 rounded-md space-y-2">
                  <input
                    type="text"
                    placeholder="Template name"
                    value={editingCustom.name}
                    onChange={(e) => setEditingCustom({ ...editingCustom, name: e.target.value })}
                    maxLength={30}
                    className="block w-full px-3 py-1.5 border border-slate-600 rounded-md bg-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    placeholder="Message body (use {firstName}, {company}, etc.)"
                    value={editingCustom.body}
                    onChange={(e) => setEditingCustom({ ...editingCustom, body: e.target.value })}
                    rows={3}
                    className="block w-full px-3 py-1.5 border border-slate-600 rounded-md bg-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setEditingCustom(null)}
                      className="px-2 py-1 text-xs text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveCustomTemplate}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Save Template
                    </button>
                  </div>
                </div>
              )}

              {/* Variable chips */}
              <p className="text-sm text-slate-400 mb-2">
                Edit your message. Available variables:
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
