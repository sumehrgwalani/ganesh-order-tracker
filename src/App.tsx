import { useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Order, Stats } from './types';
import Sidebar from './layout/Sidebar';
import Header from './layout/Header';
import DashboardContent from './pages/Dashboard';
import OrdersPage from './pages/OrdersPage';
import CompletedPage from './pages/CompletedPage';
import POGeneratorPage from './pages/POGeneratorPage';
import InquiriesPage from './pages/InquiriesPage';
import ContactsPage from './pages/ContactsPage';
import MailboxPage from './pages/MailboxPage';
import ProductsPage from './pages/ProductsPage';
import OrderDetailPage from './pages/OrderDetailPage';
import TeamPage from './pages/TeamPage';
import LoginPage from './pages/LoginPage';
import { useAuth } from './hooks/useAuth';
import { useContacts } from './hooks/useContacts';
import { useOrders } from './hooks/useOrders';
import { useProducts } from './hooks/useProducts';
import { useToast } from './components/Toast';

function App() {
  const { session, user, loading: authLoading, orgId, userRole, signOut } = useAuth();
  const { contacts: dbContacts, loading: contactsLoading, addContact, updateContact, deleteContact, bulkUpsertContacts, bulkDeleteContacts, refetch: refetchContacts } = useContacts(orgId);
  const { orders: dbOrders, setOrders, loading: ordersLoading, createOrder, deleteOrder, updateOrderStage, updateOrder } = useOrders(orgId);
  const { showToast } = useToast();
  const { inquiries: productInquiries, products: dbProducts, loading: productsLoading } = useProducts(orgId);

  const contacts = dbContacts;
  const orders = dbOrders;

  // UI state that doesn't need routing
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<string>(new Date().toISOString());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const navigate = useNavigate();

  // Show login page if not authenticated
  if (!authLoading && !session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onAuthSuccess={() => {}} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Show loading while auth, org setup, or data is loading
  // Important: also show spinner when session exists but orgId isn't ready yet
  // to prevent stale data from a previous user being briefly visible
  if (authLoading || !orgId || contactsLoading || ordersLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading your data...</p>
        </div>
      </div>
    );
  }

  // Filter orders by search term AND selected stage
  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.product.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStage = selectedStage === null || order.currentStage === selectedStage;

    return matchesSearch && matchesStage;
  });

  const stats: Stats = {
    active: orders.filter(o => o.currentStage < 8).length,
    completed: orders.filter(o => o.currentStage === 8).length,
    inquiries: productInquiries.length,
    contacts: Object.keys(contacts).length,
    products: dbProducts.length,
  };

  const handleSync = async () => {
    setIsSyncing(true);
    // The hooks auto-refetch, so just update timestamp
    setTimeout(() => {
      setIsSyncing(false);
      setLastSync(new Date().toISOString());
    }, 1000);
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      if (deleteOrder) {
        await deleteOrder(orderId);
      } else {
        setOrders(prev => prev.filter(o => o.id !== orderId));
      }
      showToast('Order archived successfully', 'success');
    } catch {
      showToast('Failed to archive order', 'error');
    }
  };

  const handleUpdateStage = async (orderId: string, newStage: number, oldStage?: number) => {
    try {
      if (updateOrderStage) {
        await updateOrderStage(orderId, newStage, oldStage);
      }
      showToast('Order stage updated', 'success');
    } catch {
      showToast('Failed to update stage', 'error');
    }
  };

  const handleUpdateOrder = async (orderId: string, updates: Partial<Order>) => {
    try {
      if (updateOrder) {
        await updateOrder(orderId, updates);
      }
      showToast('Order updated successfully', 'success');
    } catch {
      showToast('Failed to update order', 'error');
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar onSettingsClick={() => {}} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header searchTerm={searchTerm} setSearchTerm={setSearchTerm} lastSync={lastSync} isSyncing={isSyncing} onSyncClick={handleSync} userEmail={user?.email} onSignOut={signOut} />
        <main className="flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={
              <DashboardContent
                orders={orders}
                stats={stats}
                filteredOrders={filteredOrders}
                selectedStage={selectedStage}
                setSelectedStage={setSelectedStage}
                onDeleteOrder={handleDeleteOrder}
                productInquiries={productInquiries}
              />
            } />
            <Route path="/orders" element={
              <OrdersPage
                orders={orders}
                onDeleteOrder={handleDeleteOrder}
              />
            } />
            <Route path="/orders/:orderId" element={
              <OrderDetailPage
                orders={orders}
                onUpdateStage={handleUpdateStage}
                onUpdateOrder={handleUpdateOrder}
                onDeleteOrder={handleDeleteOrder}
              />
            } />
            <Route path="/completed" element={
              <CompletedPage
                orders={orders}
                expandedOrder={expandedOrder}
                setExpandedOrder={setExpandedOrder}
              />
            } />
            <Route path="/mailbox" element={<MailboxPage />} />
            <Route path="/create-po" element={
              <POGeneratorPage
                contacts={contacts}
                orders={orders}
                setOrders={setOrders}
                onOrderCreated={(newOrder) => {
                  if (orgId && createOrder) {
                    createOrder(newOrder).catch(() => showToast('Failed to save order', 'error'));
                  }
                  navigate('/orders/' + encodeURIComponent(newOrder.id));
                }}
              />
            } />
            <Route path="/inquiries" element={<InquiriesPage />} />
            <Route path="/contacts" element={
              <ContactsPage
                dbContacts={dbContacts}
                onAddContact={addContact}
                onUpdateContact={updateContact}
                onDeleteContact={deleteContact}
                onBulkImport={bulkUpsertContacts}
                onBulkDelete={bulkDeleteContacts}
                onRefresh={refetchContacts}
              />
            } />
            <Route path="/products" element={<ProductsPage orders={orders} />} />
            <Route path="/team" element={<TeamPage orgId={orgId} userRole={userRole} currentUserEmail={user?.email} />} />
            {/* Redirect any unknown routes to dashboard */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
