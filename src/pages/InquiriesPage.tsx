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
          The Inquiries module is under development. Soon you'll be able to track incoming and outgoing product inquiries, respond to requests, and convert them into purchase orders.
        </p>
      </div>
    </div>
  );
}

export default InquiriesPage;
