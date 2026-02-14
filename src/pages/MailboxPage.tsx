import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';

interface Props {
  orgId: string | null;
}

function MailboxPage({ orgId }: Props) {
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Mailbox"
        subtitle="Email integration for order tracking"
        onBack={() => navigate('/')}
      />
      <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <Icon name="Mail" size={32} className="text-blue-400" />
        </div>
        <h3 className="text-xl font-semibold text-gray-800 mb-2">Coming Soon</h3>
        <p className="text-gray-500 max-w-md mx-auto">
          The Mailbox module is under development. You'll be able to view and manage emails related to your orders, with automatic email-to-order linking.
        </p>
      </div>
    </div>
  );
}

export default MailboxPage;
