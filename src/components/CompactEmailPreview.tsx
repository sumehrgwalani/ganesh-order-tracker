import { HistoryEntry } from '../types';
import ContactAvatar from './ContactAvatar';
import Icon from './Icon';
import { getContactInfo } from '../utils/helpers';

interface Props {
  entry: HistoryEntry;
  onClick?: () => void;
}

function CompactEmailPreview({ entry, onClick }: Props) {
  const contact = getContactInfo(entry.from);
  const formatTime = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex items-center gap-3 cursor-pointer" onClick={onClick}>
      <ContactAvatar email={entry.from} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">{contact.name}</span>
          {contact.role && <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{contact.role}</span>}
          <span className="text-xs text-gray-400">{formatTime(entry.timestamp)}</span>
        </div>
        <p className="text-xs text-gray-500 truncate">{entry.body?.split('\n').find(l => l.trim()) || entry.subject}</p>
      </div>
      {entry.hasAttachment && <Icon name="Paperclip" size={12} className="text-gray-400" />}
    </div>
  );
}

export default CompactEmailPreview;
