import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StatsCard from '../components/StatsCard';
import AIChatBox from '../components/AIChatBox';
import CommandCenter from '../components/CommandCenter';
import ComposeEmailModal from '../components/ComposeEmailModal';
import type { Stats } from '../types';

interface Props {
  stats: Stats;
  orgId?: string | null;
}

function DashboardContent({ stats, orgId }: Props) {
  const navigate = useNavigate();
  const [composeDraft, setComposeDraft] = useState<{ subject: string; body: string; recipients: string[] } | null>(null);

  return (
    <>
      <div className="mb-6"><h1 className="text-2xl font-bold text-gray-800">Welcome back</h1><p className="text-gray-500 mt-1">Track your seafood export orders with real-time email updates</p></div>
      {orgId && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <AIChatBox orgId={orgId} />
          <CommandCenter
            orgId={orgId}
            onComposeEmail={(draft) => setComposeDraft(draft)}
          />
        </div>
      )}
      <div className="grid grid-cols-5 gap-4 mb-8">
        <StatsCard icon="Package" title="Active Orders" value={stats.active} color="primary" onClick={() => navigate('/orders')} trend="+2 this week" />
        <StatsCard icon="CheckCircle" title="Completed" value={stats.completed} color="secondary" onClick={() => navigate('/orders?tab=completed')} />
        <StatsCard icon="MessageSquare" title="Inquiries" value={stats.inquiries} color="secondary" onClick={() => navigate('/inquiries')} />
        <StatsCard icon="Users" title="Contacts" value={stats.contacts} color="secondary" onClick={() => navigate('/contacts')} />
        <StatsCard icon="Box" title="Products" value={stats.products} color="secondary" onClick={() => navigate('/products')} />
      </div>

      {/* Compose modal triggered from AI insights */}
      {orgId && (
        <ComposeEmailModal
          isOpen={!!composeDraft}
          onClose={() => setComposeDraft(null)}
          orgId={orgId}
          prefillTo={composeDraft?.recipients}
          prefillSubject={composeDraft?.subject}
          prefillBody={composeDraft?.body}
        />
      )}
    </>
  );
}

export default DashboardContent;
