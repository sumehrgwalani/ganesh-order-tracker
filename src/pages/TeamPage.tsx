import { useState } from 'react';
import Icon from '../components/Icon';
import { useTeam } from '../hooks/useTeam';
import type { Department } from '../types';

interface TeamPageProps {
  orgId: string | null;
  userRole: string;
  currentUserEmail?: string;
}

export default function TeamPage({ orgId, userRole, currentUserEmail }: TeamPageProps) {
  const { departments, members, invitations, loading, inviteMember, cancelInvitation, toggleMemberDept, updateMemberRole, removeMember } = useTeam(orgId);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDept, setInviteDept] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);

  const isOwner = userRole === 'owner';

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteError('');
    setInviteSuccess('');

    const { error } = await inviteMember(inviteEmail, inviteDept || null, inviteRole);
    if (error) {
      setInviteError(error.message || 'Failed to send invitation');
    } else {
      setInviteSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      setInviteDept('');
      setInviteRole('member');
      setTimeout(() => setInviteSuccess(''), 3000);
    }
    setInviteLoading(false);
  };

  const getMembersForDept = (deptId: string) => members.filter(m => m.department_ids.includes(deptId));
  const unassignedMembers = members.filter(m => m.department_ids.length === 0);

  const getRoleBadge = (role: string) => {
    const config: Record<string, { bg: string; text: string; label: string }> = {
      owner: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Owner' },
      head: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Head' },
      member: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Member' },
    };
    const c = config[role] || config.member;
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
  };

  const getDeptIcon = (slug: string) => {
    const icons: Record<string, string> = { 'purchase': 'FilePlus', 'sales': 'Mail', 'accounts': 'FileText', 'docs-artwork': 'Folder' };
    return icons[slug] || 'Package';
  };

  const getDeptColor = (slug: string) => {
    const colors: Record<string, string> = { 'purchase': 'bg-blue-50 border-blue-200', 'sales': 'bg-green-50 border-green-200', 'accounts': 'bg-purple-50 border-purple-200', 'docs-artwork': 'bg-orange-50 border-orange-200' };
    return colors[slug] || 'bg-gray-50 border-gray-200';
  };

  const getDeptIconColor = (slug: string) => {
    const colors: Record<string, string> = { 'purchase': 'text-blue-600 bg-blue-100', 'sales': 'text-green-600 bg-green-100', 'accounts': 'text-purple-600 bg-purple-100', 'docs-artwork': 'text-orange-600 bg-orange-100' };
    return colors[slug] || 'text-gray-600 bg-gray-100';
  };

  // Active pill (member IS in this dept) — filled style
  const getDeptPillActive = (slug: string) => {
    const s: Record<string, string> = { 'purchase': 'bg-blue-600 text-white border-blue-600', 'sales': 'bg-green-600 text-white border-green-600', 'accounts': 'bg-purple-600 text-white border-purple-600', 'docs-artwork': 'bg-orange-500 text-white border-orange-500' };
    return s[slug] || 'bg-gray-600 text-white border-gray-600';
  };

  // Inactive pill (member is NOT in this dept) — outlined style
  const getDeptPillInactive = (slug: string) => {
    const s: Record<string, string> = { 'purchase': 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50', 'sales': 'bg-white text-green-600 border-green-300 hover:bg-green-50', 'accounts': 'bg-white text-purple-600 border-purple-300 hover:bg-purple-50', 'docs-artwork': 'bg-white text-orange-500 border-orange-300 hover:bg-orange-50' };
    return s[slug] || 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50';
  };

  // Render toggle-style department pills for a member
  const renderDeptToggles = (memberId: string, memberDeptIds: string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {departments.map(d => {
        const isIn = memberDeptIds.includes(d.id);
        return (
          <button
            key={d.id}
            onClick={() => toggleMemberDept(memberId, d.id)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${isIn ? getDeptPillActive(d.slug) : getDeptPillInactive(d.slug)}`}
            title={isIn ? `Remove from ${d.name}` : `Add to ${d.name}`}
          >
            {isIn && <Icon name="CheckCircle" size={11} />}
            <Icon name={getDeptIcon(d.slug)} size={12} />
            {d.name}
          </button>
        );
      })}
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <p className="text-gray-500 mt-1">{members.length} member{members.length !== 1 ? 's' : ''} across {departments.length} departments</p>
        </div>
        {isOwner && (
          <button onClick={() => setShowInviteForm(!showInviteForm)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors">
            <Icon name="Plus" size={16} />
            Invite Member
          </button>
        )}
      </div>

      {/* Owner access info */}
      {isOwner && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Icon name="Eye" size={16} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-blue-800">Owner Access</p>
            <p className="text-xs text-blue-600">As the owner, you have full access to all data across every department. Members can belong to multiple departments.</p>
          </div>
        </div>
      )}

      {/* Invite Form */}
      {showInviteForm && isOwner && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-4">Invite a Team Member</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@company.com" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <select value={inviteDept} onChange={(e) => setInviteDept(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <option value="">No department</option>
                {departments.map((d: Department) => (<option key={d.id} value={d.id}>{d.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <option value="member">Member</option>
                <option value="head">Department Head</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={handleInvite} disabled={!inviteEmail.trim() || inviteLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {inviteLoading ? (<><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Sending...</>) : (<><Icon name="Send" size={16} /> Send Invitation</>)}
            </button>
            <button onClick={() => setShowInviteForm(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
          </div>
          {inviteSuccess && <p className="mt-3 text-sm text-green-600 flex items-center gap-1"><Icon name="CheckCircle" size={14} /> {inviteSuccess}</p>}
          {inviteError && <p className="mt-3 text-sm text-red-600 flex items-center gap-1"><Icon name="AlertCircle" size={14} /> {inviteError}</p>}
        </div>
      )}

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
          <h3 className="font-medium text-yellow-800 mb-3 flex items-center gap-2"><Icon name="Clock" size={16} /> Pending Invitations ({invitations.length})</h3>
          <div className="space-y-2">
            {invitations.map(inv => (
              <div key={inv.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border border-yellow-100">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-800">{inv.email}</span>
                  {inv.department && <span className="text-xs text-gray-500">{inv.department.name}</span>}
                  {getRoleBadge(inv.role)}
                </div>
                {isOwner && (<button onClick={() => cancelInvitation(inv.id)} className="text-xs text-red-500 hover:text-red-700">Cancel</button>)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Department Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {departments.map((dept: Department) => {
          const deptMembers = getMembersForDept(dept.id);
          return (
            <div key={dept.id} className={`rounded-xl border p-5 ${getDeptColor(dept.slug)}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${getDeptIconColor(dept.slug)}`}>
                  <Icon name={getDeptIcon(dept.slug)} size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800">{dept.name}</h3>
                  <p className="text-xs text-gray-500">{dept.description}</p>
                </div>
              </div>

              {deptMembers.length === 0 ? (
                <p className="text-sm text-gray-400 italic py-3">No members yet</p>
              ) : (
                <div className="space-y-2">
                  {deptMembers.map(member => (
                    <div key={member.id}>
                      <div className="flex items-center justify-between bg-white/70 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                            {member.email ? member.email[0].toUpperCase() : 'U'}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{member.email || `User ${member.user_id.slice(0, 8)}`}</p>
                            {member.department_ids.length > 1 && (
                              <p className="text-xs text-gray-400">{member.department_ids.length} departments</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getRoleBadge(member.role)}
                          {member.role === 'owner' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200">All Depts</span>
                          )}
                          {isOwner && (
                            <button
                              onClick={() => setEditingMemberId(editingMemberId === member.id ? null : member.id)}
                              className={`p-1 rounded transition-colors ${editingMemberId === member.id ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-white/50'}`}
                              title="Edit departments"
                            >
                              <Icon name="Edit" size={13} />
                            </button>
                          )}
                          {isOwner && member.role !== 'owner' && (
                            <button onClick={() => removeMember(member.id)} className="text-gray-400 hover:text-red-500 transition-colors" title="Remove member">
                              <Icon name="X" size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      {editingMemberId === member.id && (
                        <div className="mt-1.5 ml-10 px-3 py-2 bg-white rounded-lg border border-gray-200 shadow-sm">
                          <p className="text-xs text-gray-500 mb-2">Toggle departments:</p>
                          {renderDeptToggles(member.id, member.department_ids)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 text-xs text-gray-500">
                {deptMembers.length} member{deptMembers.length !== 1 ? 's' : ''}
              </div>
            </div>
          );
        })}
      </div>

      {/* Unassigned Members */}
      {unassignedMembers.length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Icon name="Users" size={18} />
            Not Assigned to Department
          </h3>
          <div className="space-y-3">
            {unassignedMembers.map(member => (
              <div key={member.id} className="bg-gray-50 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                      {member.email ? member.email[0].toUpperCase() : 'U'}
                    </div>
                    <span className="text-sm font-medium text-gray-800">{member.email || `User ${member.user_id.slice(0, 8)}`}</span>
                    {getRoleBadge(member.role)}
                    {member.role === 'owner' && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200">All Depts</span>
                    )}
                  </div>
                </div>
                {isOwner && (
                  <div className="mt-2.5 ml-11">
                    <p className="text-xs text-gray-400 mb-1.5">Add to departments:</p>
                    {renderDeptToggles(member.id, member.department_ids)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
