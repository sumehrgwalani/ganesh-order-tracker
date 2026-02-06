import { useState } from 'react';
import { HistoryEntry } from '../types';
import Icon from './Icon';
import ContactAvatar from './ContactAvatar';
import { getContactInfo } from '../utils/helpers';

interface Props {
  entry: HistoryEntry;
  defaultExpanded?: boolean;
}

function ExpandableEmailCard({ entry, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contact = getContactInfo(entry.from);
  const formatTime = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

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
                {entry.attachments.map((att, idx) => (
                  <span key={idx} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 rounded-lg text-xs text-gray-700 hover:bg-gray-200 cursor-pointer">
                    <Icon name="Paperclip" size={12} /> {att} <Icon name="ExternalLink" size={10} className="text-gray-400" />
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ExpandableEmailCard;
