import { useState, useRef } from 'react';
import { HistoryEntry, getAttachmentName, getAttachmentMeta } from '../types';
import Icon from './Icon';
import ContactAvatar from './ContactAvatar';
import { getContactInfo } from '../utils/helpers';
import ReassignEmailModal from './ReassignEmailModal';

interface OrderOption {
  id: string;
  poNumber: string;
  company: string;
  product: string;
}

interface Props {
  entry: HistoryEntry;
  defaultExpanded?: boolean;
  orderId?: string;
  allOrders?: OrderOption[];
  onReassign?: (entryId: string, newOrderId: string, note: string) => Promise<void>;
  onRemove?: (entryId: string, note: string) => Promise<void>;
  onAttachmentClick?: (name: string, url: string) => void;
  onAssignAttachment?: (entryId: string, stage: number, file: File) => Promise<void>;
  onDownloadAttachment?: (entryId: string, stage: number) => Promise<void>;
}

const STAGE_OPTIONS = [
  { stage: 1, label: 'Purchase Order' },
  { stage: 2, label: 'Proforma Invoice' },
  { stage: 3, label: 'Artwork' },
  { stage: 4, label: 'Artwork Confirmed' },
  { stage: 5, label: 'Quality Check' },
  { stage: 6, label: 'Schedule Confirmed' },
  { stage: 7, label: 'Draft Documents' },
  { stage: 8, label: 'Final Documents' },
  { stage: 9, label: 'DHL Number' },
];

function ExpandableEmailCard({ entry, defaultExpanded = false, orderId, allOrders, onReassign, onRemove, onAttachmentClick, onAssignAttachment, onDownloadAttachment }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showReassign, setShowReassign] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [assignStage, setAssignStage] = useState(entry.stage || 1);
  const [assignUploading, setAssignUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const assignFileRef = useRef<HTMLInputElement>(null);
  const contact = getContactInfo(entry.from);
  const formatTime = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const canReassign = entry.id && orderId && allOrders && allOrders.length > 1 && onReassign;
  const isSystemEntry = entry.from === 'System';
  // Show assign button if email has attachments but no stored attachment URLs
  const hasUnlinkedAttachments = entry.hasAttachment && (!entry.attachments || entry.attachments.length === 0 || entry.attachments.every(att => !getAttachmentMeta(att)?.pdfUrl));

  const handleAssignFile = async (file: File) => {
    if (!entry.id || !onAssignAttachment) return;
    setAssignUploading(true);
    try {
      await onAssignAttachment(entry.id, assignStage, file);
      setShowAssign(false);
    } catch (err: any) {
      alert('Failed to assign: ' + (err?.message || 'Unknown error'));
    }
    setAssignUploading(false);
  };

  return (
    <div className={`border rounded-xl transition-all ${expanded ? 'border-blue-300 shadow-md' : 'border-gray-200 hover:border-blue-200'} bg-white overflow-hidden`}>
      <div className="p-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start gap-3">
          <ContactAvatar email={entry.from} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-800">{contact.name}</span>
                {contact.role && <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">{contact.role}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{formatTime(entry.timestamp)}</span>
                <Icon name="ChevronDown" size={16} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </div>
            </div>
            {contact.company && <p className="text-xs text-gray-500 mb-1">{contact.company}</p>}
            <p className="text-sm text-gray-700 font-medium truncate">{entry.subject}</p>
            {!expanded && <p className="text-sm text-gray-500 truncate mt-1">{entry.body?.split('\n')[0]}</p>}
            <div className="flex items-center gap-3 mt-2">
              {entry.hasAttachment && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Icon name="Paperclip" size={12} />
                  {entry.attachments?.length || 1} attachment{(entry.attachments?.length ?? 0) > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-gray-100">
          <div className="px-4 py-3 bg-gray-50 text-xs space-y-1">
            <p><span className="text-gray-500">From:</span> <span className="text-gray-700">{entry.from}</span></p>
            {entry.to && <p><span className="text-gray-500">To:</span> <span className="text-gray-700">{entry.to}</span></p>}
            <p><span className="text-gray-500">Date:</span> <span className="text-gray-700">{new Date(entry.timestamp).toLocaleString()}</span></p>
            <p><span className="text-gray-500">Subject:</span> <span className="text-gray-700 font-medium">{entry.subject}</span></p>
          </div>
          <div className="p-4">
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{entry.body}</pre>
          </div>
          {entry.attachments && entry.attachments.length > 0 && (
            <div className="px-4 pb-4">
              <p className="text-xs text-gray-500 mb-2 font-medium">Attachments:</p>
              <div className="flex flex-wrap gap-2">
                {entry.attachments.map((att, idx) => {
                  const name = getAttachmentName(att);
                  const meta = getAttachmentMeta(att);
                  const url = meta?.pdfUrl;
                  return (
                    <button
                      key={idx}
                      onClick={(e) => { e.stopPropagation(); if (url && onAttachmentClick) onAttachmentClick(name, url); }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        url ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer' : 'bg-gray-100 text-gray-700 cursor-default'
                      }`}
                    >
                      <Icon name={name.toLowerCase().endsWith('.pdf') ? 'FileText' : 'Paperclip'} size={12} />
                      {name}
                      {url && <Icon name="ExternalLink" size={10} className="text-blue-400 ml-1" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* Action buttons row */}
          {(!isSystemEntry && (canReassign || (hasUnlinkedAttachments && onAssignAttachment))) && (
            <div className="px-4 pb-3 border-t border-gray-100 pt-3 flex items-center gap-2 flex-wrap">
              {/* Assign attachment button */}
              {hasUnlinkedAttachments && onAssignAttachment && entry.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAssign(!showAssign); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <Icon name="Upload" size={12} />
                  Assign Attachments to Stage
                </button>
              )}
              {/* Reassign button */}
              {canReassign && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowReassign(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
                >
                  <Icon name="ArrowRightLeft" size={12} />
                  Wrong Order? Reassign
                </button>
              )}
            </div>
          )}

          {/* Assign attachment inline panel */}
          {showAssign && (
            <div className="px-4 pb-4 border-t border-blue-100 bg-blue-50/30" onClick={e => e.stopPropagation()}>
              <p className="text-xs text-gray-600 mt-3 mb-2">Download the attachment from this email and assign it to a document stage:</p>
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={assignStage}
                  onChange={e => setAssignStage(Number(e.target.value))}
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white"
                >
                  {STAGE_OPTIONS.map(s => (
                    <option key={s.stage} value={s.stage}>{s.label}</option>
                  ))}
                </select>
                {/* Primary: Download from Gmail */}
                {onDownloadAttachment && entry.id && (
                  <button
                    onClick={async () => {
                      if (!entry.id || !onDownloadAttachment) return;
                      setDownloading(true);
                      try {
                        await onDownloadAttachment(entry.id, assignStage);
                        setShowAssign(false);
                      } catch (err: any) {
                        alert('Failed to download: ' + (err?.message || 'Unknown error'));
                      }
                      setDownloading(false);
                    }}
                    disabled={downloading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <Icon name="Download" size={12} />
                    {downloading ? 'Downloading...' : 'Download & Assign'}
                  </button>
                )}
                {/* Fallback: Upload from computer */}
                <input
                  ref={assignFileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleAssignFile(file);
                    if (assignFileRef.current) assignFileRef.current.value = '';
                  }}
                />
                {onAssignAttachment && entry.id && (
                  <button
                    onClick={() => assignFileRef.current?.click()}
                    disabled={assignUploading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <Icon name="Upload" size={12} />
                    {assignUploading ? 'Uploading...' : 'Or Upload File'}
                  </button>
                )}
                <button
                  onClick={() => setShowAssign(false)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reassign Modal */}
      {showReassign && orderId && allOrders && onReassign && (
        <ReassignEmailModal
          currentOrderId={orderId}
          orders={allOrders}
          onReassign={async (newOrderId, note) => {
            if (entry.id && onReassign) await onReassign(entry.id, newOrderId, note);
          }}
          onRemove={async (note) => {
            if (entry.id && onRemove) await onRemove(entry.id, note);
          }}
          onClose={() => setShowReassign(false)}
        />
      )}
    </div>
  );
}

export default ExpandableEmailCard;
