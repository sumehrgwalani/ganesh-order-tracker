import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { EmailAttachment, ContactsMap } from '../types';
import Icon from './Icon';

interface ComposeProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string | null;
  contacts?: ContactsMap;
  prefillTo?: string[];
  prefillSubject?: string;
  prefillBody?: string;
  inReplyToMessageId?: string;
  attachmentBlobs?: Array<{ filename: string; blob: Blob; mimeType: string }>;
  onSent?: () => void;
}

// Convert Blob to base64 string
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // strip data:...;base64, prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function ComposeEmailModal({
  isOpen, onClose, orgId, contacts,
  prefillTo, prefillSubject, prefillBody, inReplyToMessageId,
  attachmentBlobs, onSent
}: ComposeProps) {
  const [toInput, setToInput] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Array<{ filename: string; data: string; mimeType: string; size: number }>>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ email: string; name: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill values when modal opens
  useEffect(() => {
    if (isOpen) {
      setRecipients(prefillTo || []);
      setSubject(prefillSubject || '');
      setBody(prefillBody || '');
      setError('');
      setSuccess(false);
      setToInput('');
      setAttachments([]);

      // Convert pre-attached blobs to base64
      if (attachmentBlobs && attachmentBlobs.length > 0) {
        Promise.all(
          attachmentBlobs.map(async (ab) => ({
            filename: ab.filename,
            data: await blobToBase64(ab.blob),
            mimeType: ab.mimeType,
            size: ab.blob.size,
          }))
        ).then(setAttachments);
      }
    }
  }, [isOpen, prefillTo, prefillSubject, prefillBody, attachmentBlobs]);

  // Contact auto-complete
  useEffect(() => {
    if (!contacts || !toInput.trim()) {
      setSuggestions([]);
      return;
    }
    const query = toInput.toLowerCase();
    const matches = Object.entries(contacts)
      .filter(([email, c]) =>
        email.toLowerCase().includes(query) ||
        c.name.toLowerCase().includes(query) ||
        c.company.toLowerCase().includes(query)
      )
      .filter(([email]) => !recipients.includes(email))
      .slice(0, 6)
      .map(([email, c]) => ({ email, name: c.name + ' (' + c.company + ')' }));
    setSuggestions(matches);
  }, [toInput, contacts, recipients]);

  const addRecipient = (email: string) => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed && !recipients.includes(trimmed)) {
      setRecipients([...recipients, trimmed]);
    }
    setToInput('');
    setShowSuggestions(false);
    toInputRef.current?.focus();
  };

  const removeRecipient = (email: string) => {
    setRecipients(recipients.filter(r => r !== email));
  };

  const handleToKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (toInput.trim()) addRecipient(toInput);
    }
    if (e.key === 'Backspace' && !toInput && recipients.length > 0) {
      removeRecipient(recipients[recipients.length - 1]);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const data = await blobToBase64(file);
      setAttachments(prev => [...prev, {
        filename: file.name,
        data,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      }]);
    }
    e.target.value = ''; // reset input
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const totalAttachmentSize = attachments.reduce((sum, a) => sum + a.size, 0);

  const handleSend = async () => {
    if (recipients.length === 0) { setError('Add at least one recipient'); return; }
    if (!subject.trim()) { setError('Subject is required'); return; }
    if (!body.trim()) { setError('Email body is required'); return; }
    if (totalAttachmentSize > 25 * 1024 * 1024) { setError('Attachments too large (max 25MB)'); return; }

    setSending(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error: fnError } = await supabase.functions.invoke('send-email', {
        body: {
          organization_id: orgId,
          user_id: user.id,
          recipients,
          subject,
          body,
          attachments: attachments.map(a => ({ filename: a.filename, data: a.data, mimeType: a.mimeType })),
          inReplyToMessageId,
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      setSuccess(true);
      setTimeout(() => {
        onClose();
        if (onSent) onSent();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-2xl mx-0 sm:mx-4 max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-800">
            {inReplyToMessageId ? 'Reply' : 'Compose Email'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-lg transition-colors">
            <Icon name="X" size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* To field */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">To</label>
            <div className="flex flex-wrap gap-1 p-2 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 bg-white min-h-[42px]">
              {recipients.map(email => (
                <span key={email} className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-sm">
                  {email}
                  <button onClick={() => removeRecipient(email)} className="hover:bg-blue-200 rounded-full p-0.5">
                    <Icon name="X" size={12} />
                  </button>
                </span>
              ))}
              <div className="relative flex-1 min-w-[150px]">
                <input
                  ref={toInputRef}
                  type="text"
                  value={toInput}
                  onChange={e => { setToInput(e.target.value); setShowSuggestions(true); }}
                  onKeyDown={handleToKeyDown}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  placeholder={recipients.length === 0 ? 'Type email or name...' : ''}
                  className="w-full outline-none text-sm py-1"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {suggestions.map(s => (
                      <button
                        key={s.email}
                        onMouseDown={() => addRecipient(s.email)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                      >
                        <div className="font-medium text-gray-800">{s.name}</div>
                        <div className="text-gray-500 text-xs">{s.email}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              placeholder="Email subject..."
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm resize-y min-h-[120px]"
              placeholder="Type your message..."
            />
          </div>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Attachments ({formatFileSize(totalAttachmentSize)})
              </label>
              <div className="space-y-1">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-2 text-sm">
                      <Icon name="FileText" size={16} className="text-gray-400" />
                      <span className="text-gray-700">{att.filename}</span>
                      <span className="text-gray-400 text-xs">{formatFileSize(att.size)}</span>
                    </div>
                    <button onClick={() => removeAttachment(i)} className="text-gray-400 hover:text-red-500 p-1">
                      <Icon name="X" size={14} />
                    </button>
                  </div>
                ))}
              </div>
              {totalAttachmentSize > 25 * 1024 * 1024 && (
                <p className="text-red-500 text-xs mt-1">Total attachments exceed 25MB limit</p>
              )}
            </div>
          )}

          {/* Error / Success */}
          {error && (
            <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>
          )}
          {success && (
            <div className="bg-green-50 text-green-700 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
              <Icon name="Check" size={16} /> Email sent successfully!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-gray-50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <Icon name="Paperclip" size={16} />
              Attach File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || success}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              {sending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending...
                </>
              ) : success ? (
                <>
                  <Icon name="Check" size={16} />
                  Sent!
                </>
              ) : (
                <>
                  <Icon name="Send" size={16} />
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
