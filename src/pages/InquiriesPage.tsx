import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';

function InquiriesPage() {
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Product Inquiries"
        subtitle="Manage incoming and outgoing product inquiries"
        onBack={() => navigate('/')}
      />
      <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <Icon name="MessageSquare" size={32} className="text-blue-400" />
        </div>
        <h3 className="text-xl font-semibold text-gray-800 mb-2">Coming Soon</h3>
        <p className="text-gray-500 max-w-md mx-auto">
          The Inquiries module is under development. You'll be able to manage incoming and outgoing product inquiries, track responses, and convert them to orders.
        </p>
      </div>
    </div>
  );
}

export default InquiriesPage;
