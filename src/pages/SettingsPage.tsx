import { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import { useSettings } from '../hooks/useSettings';
import { supabase } from '../lib/supabase';
import type { OrganizationSettings } from '../types';

interface SettingsPageProps {
  orgId: string | null;
  userRole: string;
  currentUserEmail?: string;
  signOut: () => Promise<void>;
}

type TabType = 'organization' | 'profile' | 'currency' | 'departments' | 'notifications' | 'email' | 'export';

const TABS = [
  { id: 'organization', label: 'Organization', icon: 'Building' },
  { id: 'profile', label: 'Profile', icon: 'User' },
  { id: 'currency', label: 'Currency', icon: 'DollarSign' },
  { id: 'departments', label: 'Departments', icon: 'Users' },
  { id: 'notifications', label: 'Notifications', icon: 'Bell' },
  { id: 'email', label: 'Email', icon: 'Mail' },
  { id: 'export', label: 'Data & Export', icon: 'Download' },
];

export default function SettingsPage({ orgId, userRole, currentUserEmail, signOut }: SettingsPageProps) {
  const { orgSettings, orgName, userPrefs, departments, initialLoad, error, updateOrgSettings, updateOrgName, updateUserProfile, updateUserNotifications, changePassword, addDepartment, renameDepartment, deleteDepartment } = useSettings(orgId);
  const [activeTab, setActiveTab] = useState<TabType>('organization');
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const isOwner = userRole === 'owner';

  // Organization tab
  const [orgFormData, setOrgFormData] = useState({ name: '', address: '', city: '', country: '', phone: '', gstNumber: '', taxId: '' });

  // Profile tab
  const [profileFormData, setProfileFormData] = useState({ displayName: '', phone: '' });
  const [passwordFormData, setPasswordFormData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  // Currency tab
  const [currencyFormData, setCurrencyFormData] = useState({ currency: '', weightUnit: '', dateFormat: '' });

  // Departments tab
  const [newDeptForm, setNewDeptForm] = useState({ name: '', description: '' });
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editingDeptForm, setEditingDeptForm] = useState({ name: '', description: '' });

  // Email tab
  const [emailFormData, setEmailFormData] = useState({ provider: 'none', smtpHost: '', smtpPort: '', smtpUsername: '', smtpPassword: '', smtpFromEmail: '', smtpUseTls: false, sendgridKey: '', resendKey: '' });

  // Initialize form data when settings load
  useEffect(() => {
    if (orgName) setOrgFormData(prev => ({ ...prev, name: orgName }));
    if (orgSettings) {
      setCurrencyFormData({
        currency: orgSettings.default_currency || 'USD',
        weightUnit: orgSettings.weight_unit || 'kg',
        dateFormat: orgSettings.date_format || 'DD/MM/YYYY',
      });
      setEmailFormData(prev => ({
        ...prev,
        provider: orgSettings.email_provider || 'none',
        smtpHost: orgSettings.smtp_host || '',
        smtpPort: orgSettings.smtp_port ? String(orgSettings.smtp_port) : '',
        smtpUsername: orgSettings.smtp_username || '',
        smtpPassword: orgSettings.smtp_password || '',
        smtpFromEmail: orgSettings.smtp_from_email || '',
        smtpUseTls: orgSettings.smtp_use_tls ?? false,
        sendgridKey: orgSettings.sendgrid_api_key || '',
        resendKey: orgSettings.resend_api_key || '',
      }));
    }
    if (userPrefs) {
      setProfileFormData({
        displayName: userPrefs.display_name || '',
        phone: userPrefs.phone || '',
      });
    }
  }, [orgName, orgSettings, userPrefs]);

  const showStatus = (type: 'success' | 'error', message: string) => {
    setSaveStatus({ type, message });
    setTimeout(() => setSaveStatus(null), 4000);
  };

  const handleSaveOrganization = async () => {
    const { error: nameError } = await updateOrgName(orgFormData.name);
    if (nameError) {
      showStatus('error', 'Failed to save organization');
      return;
    }
    const { error: settingsError } = await updateOrgSettings({
      address: orgFormData.address || null,
      city: orgFormData.city || null,
      country: orgFormData.country || null,
      phone: orgFormData.phone || null,
      gst_number: orgFormData.gstNumber || null,
      tax_id: orgFormData.taxId || null,
    });
    if (settingsError) {
      showStatus('error', 'Failed to save settings');
    } else {
      showStatus('success', 'Organization settings saved');
    }
  };

  const handleSaveProfile = async () => {
    const { error } = await updateUserProfile({
      display_name: profileFormData.displayName || null,
      phone: profileFormData.phone || null,
    });
    if (error) {
      showStatus('error', 'Failed to save profile');
    } else {
      showStatus('success', 'Profile saved');
    }
  };

  const handleChangePassword = async () => {
    if (!passwordFormData.currentPassword) {
      showStatus('error', 'Current password is required');
      return;
    }
    if (passwordFormData.newPassword !== passwordFormData.confirmPassword) {
      showStatus('error', 'Passwords do not match');
      return;
    }
    if (passwordFormData.newPassword.length < 6) {
      showStatus('error', 'Password must be at least 6 characters');
      return;
    }

    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: currentUserEmail || '',
        password: passwordFormData.currentPassword
      });

      if (verifyError) {
        showStatus('error', 'Current password is incorrect');
        return;
      }

      const { error } = await changePassword(passwordFormData.currentPassword, passwordFormData.newPassword);
      if (error) {
        showStatus('error', 'Failed to change password');
      } else {
        showStatus('success', 'Password changed successfully');
        setPasswordFormData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      }
    } catch (err) {
      showStatus('error', 'An error occurred while changing password');
    }
  };

  const handleSaveCurrency = async () => {
    const { error } = await updateOrgSettings({
      default_currency: currencyFormData.currency,
      weight_unit: currencyFormData.weightUnit,
      date_format: currencyFormData.dateFormat,
    });
    if (error) {
      showStatus('error', 'Failed to save currency settings');
    } else {
      showStatus('success', 'Currency settings saved');
    }
  };

  const handleAddDepartment = async () => {
    if (!newDeptForm.name.trim()) {
      showStatus('error', 'Department name is required');
      return;
    }
    const { error } = await addDepartment(newDeptForm.name, newDeptForm.description);
    if (error) {
      showStatus('error', 'Failed to add department');
    } else {
      showStatus('success', 'Department added');
      setNewDeptForm({ name: '', description: '' });
    }
  };

  const handleSaveEditDept = async (id: string) => {
    if (!editingDeptForm.name.trim()) {
      showStatus('error', 'Department name is required');
      return;
    }
    const { error } = await renameDepartment(id, editingDeptForm.name, editingDeptForm.description);
    if (error) {
      showStatus('error', 'Failed to update department');
    } else {
      showStatus('success', 'Department updated');
      setEditingDeptId(null);
    }
  };

  const handleDeleteDept = (id: string) => {
    if (window.confirm('Are you sure you want to delete this department?')) {
      deleteDepartment(id);
      showStatus('success', 'Department deleted');
    }
  };

  const handleToggleNotification = async (key: keyof typeof userPrefs, value: boolean) => {
    const notificationKey = `notify_${key}` as const;
    const updates: Record<string, boolean> = { [notificationKey]: value };
    const { error } = await updateUserNotifications(updates);
    if (error) {
      showStatus('error', 'Failed to update notification');
    }
  };

  const handleSaveEmailSettings = async () => {
    const updates: Partial<OrganizationSettings> = {
      email_provider: emailFormData.provider,
      smtp_host: emailFormData.provider === 'smtp' ? emailFormData.smtpHost : null,
      smtp_port: emailFormData.provider === 'smtp' ? parseInt(emailFormData.smtpPort, 10) : null,
      smtp_username: emailFormData.provider === 'smtp' ? emailFormData.smtpUsername : null,
      smtp_password: emailFormData.provider === 'smtp' ? emailFormData.smtpPassword : null,
      smtp_from_email: emailFormData.provider === 'smtp' ? emailFormData.smtpFromEmail : null,
      smtp_use_tls: emailFormData.provider === 'smtp' ? emailFormData.smtpUseTls : false,
      sendgrid_api_key: emailFormData.provider === 'sendgrid' ? emailFormData.sendgridKey : null,
      resend_api_key: emailFormData.provider === 'resend' ? emailFormData.resendKey : null,
    };
    const { error } = await updateOrgSettings(updates);
    if (error) {
      showStatus('error', 'Failed to save email settings');
    } else {
      showStatus('success', 'Email settings saved');
    }
  };

  if (initialLoad) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your organization and account preferences</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <Icon name={tab.icon} size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {/* Organization Tab */}
        {activeTab === 'organization' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            {!isOwner && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                <Icon name="AlertCircle" size={16} className="text-yellow-600 flex-shrink-0" />
                <p className="text-sm text-yellow-800">Only the organization owner can change these settings.</p>
              </div>
            )}

            {isOwner && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                  <input type="text" value={orgFormData.name} onChange={(e) => setOrgFormData({ ...orgFormData, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input type="text" value={orgFormData.address} onChange={(e) => setOrgFormData({ ...orgFormData, address: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                    <input type="text" value={orgFormData.city} onChange={(e) => setOrgFormData({ ...orgFormData, city: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                    <input type="text" value={orgFormData.country} onChange={(e) => setOrgFormData({ ...orgFormData, country: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input type="tel" value={orgFormData.phone} onChange={(e) => setOrgFormData({ ...orgFormData, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">GST Number</label>
                    <input type="text" value={orgFormData.gstNumber} onChange={(e) => setOrgFormData({ ...orgFormData, gstNumber: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tax ID</label>
                  <input type="text" value={orgFormData.taxId} onChange={(e) => setOrgFormData({ ...orgFormData, taxId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>

                <button onClick={handleSaveOrganization} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Changes</button>
                {saveStatus && <p className={`text-sm flex items-center gap-1 ${saveStatus.type === 'success' ? 'text-green-600' : 'text-red-600'}`}><Icon name={saveStatus.type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={14} /> {saveStatus.message}</p>}
              </div>
            )}
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Profile Information</h3>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={currentUserEmail || ''} disabled className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input type="text" value={profileFormData.displayName} onChange={(e) => setProfileFormData({ ...profileFormData, displayName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="tel" value={profileFormData.phone} onChange={(e) => setProfileFormData({ ...profileFormData, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <button onClick={handleSaveProfile} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Profile</button>
              {saveStatus && <p className={`text-sm flex items-center gap-1 ${saveStatus.type === 'success' ? 'text-green-600' : 'text-red-600'}`}><Icon name={saveStatus.type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={14} /> {saveStatus.message}</p>}
            </div>

            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Change Password</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                  <input type="password" value={passwordFormData.currentPassword} onChange={(e) => setPasswordFormData({ ...passwordFormData, currentPassword: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <input type="password" value={passwordFormData.newPassword} onChange={(e) => setPasswordFormData({ ...passwordFormData, newPassword: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                  <input type="password" value={passwordFormData.confirmPassword} onChange={(e) => setPasswordFormData({ ...passwordFormData, confirmPassword: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <button onClick={handleChangePassword} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Change Password</button>
              </div>
            </div>
          </div>
        )}

        {/* Currency Tab */}
        {activeTab === 'currency' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            {!isOwner && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                <Icon name="AlertCircle" size={16} className="text-yellow-600 flex-shrink-0" />
                <p className="text-sm text-yellow-800">Only the organization owner can change these settings.</p>
              </div>
            )}

            {isOwner && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default Currency</label>
                  <select value={currencyFormData.currency} onChange={(e) => setCurrencyFormData({ ...currencyFormData, currency: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    <option value="USD">USD - US Dollar</option>
                    <option value="EUR">EUR - Euro</option>
                    <option value="GBP">GBP - British Pound</option>
                    <option value="INR">INR - Indian Rupee</option>
                    <option value="SGD">SGD - Singapore Dollar</option>
                    <option value="AED">AED - UAE Dirham</option>
                    <option value="JPY">JPY - Japanese Yen</option>
                    <option value="CNY">CNY - Chinese Yuan</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Weight Unit</label>
                  <select value={currencyFormData.weightUnit} onChange={(e) => setCurrencyFormData({ ...currencyFormData, weightUnit: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    <option value="kg">Kilogram (kg)</option>
                    <option value="lbs">Pounds (lbs)</option>
                    <option value="MT">Metric Tonnes (MT)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date Format</label>
                  <select value={currencyFormData.dateFormat} onChange={(e) => setCurrencyFormData({ ...currencyFormData, dateFormat: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </div>

                <button onClick={handleSaveCurrency} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Settings</button>
                {saveStatus && <p className={`text-sm flex items-center gap-1 ${saveStatus.type === 'success' ? 'text-green-600' : 'text-red-600'}`}><Icon name={saveStatus.type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={14} /> {saveStatus.message}</p>}
              </div>
            )}
          </div>
        )}

        {/* Departments Tab */}
        {activeTab === 'departments' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            {!isOwner && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                <Icon name="AlertCircle" size={16} className="text-yellow-600 flex-shrink-0" />
                <p className="text-sm text-yellow-800">Only the organization owner can manage departments.</p>
              </div>
            )}

            {isOwner && (
              <>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Add Department</h3>
                <div className="bg-gray-50 rounded-lg p-4 mb-6 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Department Name</label>
                    <input type="text" value={newDeptForm.name} onChange={(e) => setNewDeptForm({ ...newDeptForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <textarea value={newDeptForm.description} onChange={(e) => setNewDeptForm({ ...newDeptForm, description: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <button onClick={handleAddDepartment} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Add Department</button>
                </div>

                <h3 className="text-lg font-semibold text-gray-800 mb-4">Existing Departments</h3>
                {departments.length === 0 ? (
                  <p className="text-gray-500 italic">No departments yet</p>
                ) : (
                  <div className="space-y-3">
                    {departments.map(dept => (
                      <div key={dept.id}>
                        {editingDeptId === dept.id ? (
                          <div className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-300">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                              <input type="text" value={editingDeptForm.name} onChange={(e) => setEditingDeptForm({ ...editingDeptForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                              <textarea value={editingDeptForm.description} onChange={(e) => setEditingDeptForm({ ...editingDeptForm, description: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => handleSaveEditDept(dept.id)} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Save</button>
                              <button onClick={() => setEditingDeptId(null)} className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-start justify-between">
                            <div>
                              <h4 className="font-medium text-gray-800">{dept.name}</h4>
                              {dept.description && <p className="text-sm text-gray-600 mt-1">{dept.description}</p>}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => { setEditingDeptId(dept.id); setEditingDeptForm({ name: dept.name, description: dept.description || '' }); }} className="text-blue-600 hover:text-blue-800 p-1" title="Edit"><Icon name="Edit" size={16} /></button>
                              <button onClick={() => handleDeleteDept(dept.id)} className="text-red-600 hover:text-red-800 p-1" title="Delete"><Icon name="Trash2" size={16} /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Email Notifications</h3>
            <p className="text-sm text-gray-600 mb-6">Email notifications will be sent when these events occur</p>

            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={userPrefs.notify_new_order ?? false}
                  onChange={(e) => handleToggleNotification('notify_new_order', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">New order created</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={userPrefs.notify_order_updated ?? false}
                  onChange={(e) => handleToggleNotification('notify_order_updated', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">Order updated</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={userPrefs.notify_stage_changed ?? false}
                  onChange={(e) => handleToggleNotification('notify_stage_changed', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">Order stage changed</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={userPrefs.notify_new_inquiry ?? false}
                  onChange={(e) => handleToggleNotification('notify_new_inquiry', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">New inquiry received</span>
              </label>
            </div>
          </div>
        )}

        {/* Email Integration Tab */}
        {activeTab === 'email' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            {!isOwner && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                <Icon name="AlertCircle" size={16} className="text-yellow-600 flex-shrink-0" />
                <p className="text-sm text-yellow-800">Only the organization owner can configure email settings.</p>
              </div>
            )}

            {isOwner && (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                  <p className="text-sm text-blue-800">Email credentials are stored securely. The test email feature will be available soon.</p>
                </div>

                <h3 className="text-lg font-semibold text-gray-800 mb-4">Email Provider</h3>
                <div className="space-y-3 mb-6">
                  {[
                    { value: 'none', label: 'None' },
                    { value: 'smtp', label: 'SMTP' },
                    { value: 'sendgrid', label: 'SendGrid' },
                    { value: 'resend', label: 'Resend' },
                  ].map(option => (
                    <label key={option.value} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="provider"
                        value={option.value}
                        checked={emailFormData.provider === option.value}
                        onChange={(e) => setEmailFormData({ ...emailFormData, provider: e.target.value })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm font-medium text-gray-700">{option.label}</span>
                    </label>
                  ))}
                </div>

                {emailFormData.provider === 'smtp' && (
                  <div className="space-y-4 mb-6 bg-gray-50 p-4 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label>
                      <input type="text" value={emailFormData.smtpHost} onChange={(e) => setEmailFormData({ ...emailFormData, smtpHost: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Port</label>
                      <input type="number" value={emailFormData.smtpPort} onChange={(e) => setEmailFormData({ ...emailFormData, smtpPort: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                      <input type="text" value={emailFormData.smtpUsername} onChange={(e) => setEmailFormData({ ...emailFormData, smtpUsername: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                      <input type="password" value={emailFormData.smtpPassword} onChange={(e) => setEmailFormData({ ...emailFormData, smtpPassword: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">From Email</label>
                      <input type="email" value={emailFormData.smtpFromEmail} onChange={(e) => setEmailFormData({ ...emailFormData, smtpFromEmail: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={emailFormData.smtpUseTls}
                        onChange={(e) => setEmailFormData({ ...emailFormData, smtpUseTls: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <span className="text-sm font-medium text-gray-700">Use TLS</span>
                    </label>
                  </div>
                )}

                {emailFormData.provider === 'sendgrid' && (
                  <div className="space-y-4 mb-6 bg-gray-50 p-4 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">SendGrid API Key</label>
                      <input type="password" value={emailFormData.sendgridKey} onChange={(e) => setEmailFormData({ ...emailFormData, sendgridKey: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                  </div>
                )}

                {emailFormData.provider === 'resend' && (
                  <div className="space-y-4 mb-6 bg-gray-50 p-4 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Resend API Key</label>
                      <input type="password" value={emailFormData.resendKey} onChange={(e) => setEmailFormData({ ...emailFormData, resendKey: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                  </div>
                )}

                <button onClick={handleSaveEmailSettings} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Email Settings</button>
                {saveStatus && <p className={`text-sm flex items-center gap-1 mt-3 ${saveStatus.type === 'success' ? 'text-green-600' : 'text-red-600'}`}><Icon name={saveStatus.type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={14} /> {saveStatus.message}</p>}
              </>
            )}
          </div>
        )}

        {/* Data & Export Tab */}
        {activeTab === 'export' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Export Orders</h3>
                  <p className="text-sm text-gray-600 mt-1">Download all orders as a CSV file for external analysis and reporting.</p>
                </div>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
                  <Icon name="Download" size={16} />
                  Export as CSV
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-3 italic">Coming soon</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Export Contacts</h3>
                  <p className="text-sm text-gray-600 mt-1">Download all contacts as a CSV file for use in email campaigns and CRM systems.</p>
                </div>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
                  <Icon name="Download" size={16} />
                  Export as CSV
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-3 italic">Coming soon</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Export Inquiries</h3>
                  <p className="text-sm text-gray-600 mt-1">Download all inquiries as a CSV file for tracking and follow-up purposes.</p>
                </div>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
                  <Icon name="Download" size={16} />
                  Export as CSV
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-3 italic">Coming soon</p>
            </div>
          </div>
        )}
      </div>

      {/* Sign Out Section */}
      <div className="mt-8 pt-6 border-t border-gray-200">
        <button onClick={signOut} className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 flex items-center gap-2">
          <Icon name="LogOut" size={16} />
          Sign Out
        </button>
      </div>
    </div>
  );
}
