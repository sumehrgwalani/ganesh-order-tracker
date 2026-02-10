import { useState, useRef, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Order, Stats, AppNotification } from './types';
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
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import { useAuth } from './hooks/useAuth';
import { useContacts } from './hooks/useContacts';
import { useOrders } from './hooks/useOrders';
import { useProducts } from './hooks/useProducts';
import { useNotifications } from './hooks/useNotifications';
import { useToast } from './components/Toast';
import { supabase } from './lib/supabase';

const GOOGLE_CLIENT_ID = '926394608211-jm7i99au8f6g3jkoobgusgnco312fcfl.apps.googleusercontent.com';

function App() {
  const { session, user, loading: authLoading, orgId, userRole, signOut } = useAuth();
  const { contacts: dbContacts, loading: contactsLoading, addContact, updateContact, updateContactsByCompany, deleteContact, bulkUpsertContacts, bulkDeleteContacts, refetch: refetchContacts } = useContacts(orgId);
  const { orders: dbOrders, setOrders, loading: ordersLoading, createOrder, deleteOrder, updateOrderStage, updateOrder } = useOrders(orgId);
  const { showToast } = useToast();
  const { inquiries: productInquiries, products: dbProducts, loading: productsLoading } = useProducts(orgId);

  // Notifications
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    acceptInvitation,
    declineInvitation,
  } = useNotifications(user?.id || null);

  // Ref to programmatically scroll to top / trigger header bell
  const headerBellRef = useRef<(() => void) | null>(null);

  // Handle Gmail OAuth callback (when Google redirects back with ?code=xxx&state=gmail-oauth)
  // This runs in the popup window after Google redirects back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || state !== 'gmail-oauth' || !orgId) return;

    // Clean the URL immediately
    window.history.replaceState({}, '', window.location.pathname + '#/settings');

    const handleOAuthCallback = async () => {
      let result: any;
      try {
        const redirectUri = window.location.origin + window.location.pathname;
        // Use refreshSession to get a fresh access token (getSession may return expired token in popup)
        const { data: { session: authSession }, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !authSession) throw new Error('Not authenticated. Please log in and try again.');

        // Use fetch directly (not supabase SDK) for better error messages
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-auth`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authSession.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ code, client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri, organization_id: orgId, user_id: authSession.user.id }),
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
          throw new Error(data.error || `Server error ${resp.status}`);
        }

        result = { success: true, email: data.email };
      } catch (err: any) {
        result = { success: false, error: err.message };
      }

      // If opened as popup, send result to parent window and close
      if (window.opener) {
        window.opener.postMessage({ type: 'gmail-oauth-result', ...result }, window.location.origin);
        // Small delay so postMessage is received before popup closes
        setTimeout(() => window.close(), 300);
      } else {
        // Fallback: store in sessionStorage and navigate
        sessionStorage.setItem('gmail-oauth-result', JSON.stringify(result));
        navigate('/settings');
      }
    };

    handleOAuthCallback();
  }, [orgId]);

  const contacts = dbContacts;
  const orders = dbOrders;

  // UI state that doesn't need routing
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<string>(new Date().toISOString());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const navigate = useNavigate();

  // Handle accepting an invitation
  const handleAcceptInvitation = async (notification: AppNotification) => {
    const result = await acceptInvitation(notification);
    if (result.error) {
      showToast(result.error, 'error');
    } else {
      showToast('Invitation accepted! Reloading...', 'success');
      // Reload the page so the auth hook picks up the new org membership
      setTimeout(() => window.location.reload(), 1000);
    }
  };

  // Handle declining an invitation
  const handleDeclineInvitation = async (notification: AppNotification) => {
    const result = await declineInvitation(notification);
    if (result.error) {
      showToast(result.error, 'error');
    } else {
      showToast('Invitation declined', 'info');
    }
  };

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
      <Sidebar
        onSettingsClick={() => navigate('/settings')}
        unreadCount={unreadCount}
        onBellClick={() => {
          // Scroll to top and the header bell handles the dropdown
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          lastSync={lastSync}
          isSyncing={isSyncing}
          onSyncClick={handleSync}
          userEmail={user?.email}
          onSignOut={signOut}
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkAsRead={markAsRead}
          onMarkAllAsRead={markAllAsRead}
          onAcceptInvitation={handleAcceptInvitation}
          onDeclineInvitation={handleDeclineInvitation}
        />
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
                orgId={orgId}
                contacts={dbContacts}
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
            <Route path="/mailbox" element={<MailboxPage orgId={orgId} />} />
            <Route path="/create-po" element={
              <POGeneratorPage
                contacts={contacts}
                orders={orders}
                setOrders={setOrders}
                onOrderCreated={(newOrder) => {
                  const isExisting = orders.some(o => o.id === newOrder.id);
                  if (isExisting && orgId && updateOrder) {
                    // Amendment: update existing order
                    updateOrder(newOrder.id, newOrder).catch(() => showToast('Failed to update order', 'error'));
                  } else if (orgId && createOrder) {
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
                orgId={orgId}
                onAddContact={addContact}
                onUpdateContact={updateContact}
                onUpdateContactsByCompany={updateContactsByCompany}
                onDeleteContact={deleteContact}
                onBulkImport={bulkUpsertContacts}
                onBulkDelete={bulkDeleteContacts}
                onRefresh={refetchContacts}
              />
            } />
            <Route path="/products" element={<ProductsPage orders={orders} />} />
            <Route path="/team" element={<TeamPage orgId={orgId} userRole={userRole} currentUserEmail={user?.email} />} />
            <Route path="/settings" element={<SettingsPage orgId={orgId} userRole={userRole} currentUserEmail={user?.email} signOut={signOut} />} />
            {/* Redirect any unknown routes to dashboard */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
