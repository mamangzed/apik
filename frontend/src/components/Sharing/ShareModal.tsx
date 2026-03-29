import { useEffect, useState } from 'react';
import { Copy, Globe2, Lock, UserPlus, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import axios from 'axios';
import { useAppStore } from '../../store';
import { CollectionMemberRole } from '../../types';
import { getAppBaseUrl } from '../../lib/runtimeConfig';

type DisplayMember = {
  userId: string;
  role: 'owner' | CollectionMemberRole;
  isOwner: boolean;
};

export default function ShareModal() {
  const {
    collections,
    shareModalCollectionId,
    shareModalTarget,
    setShowShareModal,
    updateCollectionShareAccess,
    loadCollectionMembers,
    upsertCollectionMember,
    removeCollectionMember,
    userId,
    storageMode,
  } = useAppStore();

  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState<CollectionMemberRole>('viewer');
  const [loadingMembers, setLoadingMembers] = useState(false);

  const collection = collections.find((entry) => entry.id === shareModalCollectionId);
  if (!collection) {
    return null;
  }

  const share = collection.sharing[shareModalTarget];
  const members = collection.collaborators || [];
  const canManageMembers =
    storageMode === 'remote' &&
    (collection.currentUserRole === 'owner' ||
      (Boolean(userId) && Boolean(collection.ownerUserId) && collection.ownerUserId === userId));
  const currentAccessLabel = collection.currentUserRole || (canManageMembers ? 'owner' : null);
  const sharePath = shareModalTarget === 'docs' ? 'docs' : shareModalTarget === 'form' ? 'forms' : 'collections';
  const shareUrl = share.token ? `${getAppBaseUrl()}/share/${sharePath}/${share.token}` : '';
  const displayMembers: DisplayMember[] = [
    ...(collection.ownerUserId
      ? [
          {
            userId: collection.ownerUserId,
            role: 'owner' as const,
            isOwner: true,
          },
        ]
      : []),
    ...members
      .filter((member) => member.userId !== collection.ownerUserId)
      .map((member) => ({
        userId: member.userId,
        role: member.role,
        isOwner: false,
      })),
  ];

  useEffect(() => {
    if (!shareModalCollectionId) {
      return;
    }

    if (storageMode !== 'remote') {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setLoadingMembers(true);
        await loadCollectionMembers(shareModalCollectionId);
      } catch (error) {
        if (!cancelled) {
          if (axios.isAxiosError(error)) {
            const apiMessage =
              (error.response?.data as { error?: string } | undefined)?.error || error.message;
            toast.error(`Failed to load team members: ${apiMessage}`);
          } else {
            toast.error('Failed to load team members');
          }
        }
      } finally {
        if (!cancelled) {
          setLoadingMembers(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [loadCollectionMembers, shareModalCollectionId, storageMode]);

  const handleChange = async (access: 'private' | 'public') => {
    const updated = await updateCollectionShareAccess(collection.id, shareModalTarget, access);
    if (updated.sharing[shareModalTarget].access === 'public') {
      toast.success('Share link ready');
    } else {
      toast('Sharing set to private', { icon: '🔒' });
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) {
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
    toast.success('Share link copied');
  };

  const handleAddOrUpdateMember = async () => {
    const targetUserId = memberUserId.trim();
    if (!targetUserId) {
      toast.error('User ID is required');
      return;
    }

    try {
      await upsertCollectionMember(collection.id, targetUserId, memberRole);
      toast.success('Member access updated');
      setMemberUserId('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update member');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeCollectionMember(collection.id, userId);
      toast.success('Member removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove member');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowShareModal(false)}>
      <div className="w-full max-w-2xl bg-app-panel border border-app-border rounded-xl shadow-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border bg-app-sidebar">
          <div>
            <h3 className="text-sm font-semibold text-app-text">
              {shareModalTarget === 'docs' ? 'Share API Documentation' : shareModalTarget === 'form' ? 'Share Public Form' : 'Share Collection'}
            </h3>
            <p className="text-xs text-app-muted mt-1">{collection.name}</p>
          </div>
          <button onClick={() => setShowShareModal(false)} className="p-1.5 hover:bg-app-hover rounded text-app-muted hover:text-app-text">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleChange('private')}
              className={`p-4 rounded-lg border text-left transition-colors ${
                share.access === 'private' ? 'border-app-accent bg-app-active' : 'border-app-border hover:border-app-accent/60'
              }`}
            >
              <Lock size={16} className="text-app-text mb-2" />
              <div className="text-sm font-medium text-app-text">Private</div>
              <div className="text-xs text-app-muted mt-1">Only visible inside your account.</div>
            </button>

            <button
              onClick={() => handleChange('public')}
              className={`p-4 rounded-lg border text-left transition-colors ${
                share.access === 'public' ? 'border-app-accent bg-app-active' : 'border-app-border hover:border-app-accent/60'
              }`}
            >
              <Globe2 size={16} className="text-app-text mb-2" />
              <div className="text-sm font-medium text-app-text">Public</div>
              <div className="text-xs text-app-muted mt-1">Anyone with the link can open it without login.</div>
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-app-muted">Share link</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={share.access === 'public' ? shareUrl : 'Set to public to generate a share link'}
                className="input-field font-mono text-xs"
              />
              <button
                onClick={handleCopy}
                disabled={share.access !== 'public' || !shareUrl}
                className="btn-primary text-xs py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>

          <div className="border-t border-app-border pt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-app-text">
              <Users size={14} />
              Team Access (Private Collaboration)
            </div>

            {currentAccessLabel && (
              <div className="text-xs text-app-muted">
                Your access:
                <span className="ml-2 inline-flex items-center rounded-full border border-app-border bg-app-active px-2 py-0.5 font-medium text-app-text capitalize">
                  {currentAccessLabel}
                </span>
              </div>
            )}

            {canManageMembers ? (
              <div className="flex gap-2">
                <input
                  value={memberUserId}
                  onChange={(event) => setMemberUserId(event.target.value)}
                  placeholder="Clerk User ID / email / username"
                  className="input-field text-xs font-mono"
                />
                <select
                  value={memberRole}
                  onChange={(event) => setMemberRole(event.target.value as CollectionMemberRole)}
                  className="bg-app-panel border border-app-border rounded px-2 py-1.5 text-xs text-app-text"
                >
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                </select>
                <button onClick={handleAddOrUpdateMember} className="btn-primary text-xs py-1.5 inline-flex items-center gap-1">
                  <UserPlus size={13} />
                  Add / Update
                </button>
              </div>
            ) : (
              <p className="text-xs text-app-muted">Only collection owner can manage members.</p>
            )}

            <div className="border border-app-border rounded-lg overflow-hidden">
              <div className="flex items-center px-3 py-2 bg-app-sidebar border-b border-app-border text-xs text-app-muted">
                <div className="flex-1">User ID</div>
                <div className="w-20">Role</div>
                <div className="w-20 text-right">Action</div>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {loadingMembers ? (
                  <div className="px-3 py-3 text-xs text-app-muted">Loading members...</div>
                ) : displayMembers.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-app-muted">No collaborators yet.</div>
                ) : (
                  displayMembers.map((member) => (
                    <div key={member.userId} className="flex items-center px-3 py-2 border-b border-app-border/60 last:border-b-0 text-xs">
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="font-mono text-app-text truncate">{member.userId}</div>
                        {member.userId === userId && (
                          <div className="text-[11px] text-app-muted mt-0.5">You</div>
                        )}
                      </div>
                      <div className="w-20 text-app-muted">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
                            member.role === 'owner'
                              ? 'bg-orange-900/40 text-orange-300'
                              : member.role === 'editor'
                                ? 'bg-blue-900/40 text-blue-300'
                                : 'bg-app-active text-app-muted'
                          }`}
                        >
                          {member.role}
                        </span>
                      </div>
                      <div className="w-20 text-right">
                        {canManageMembers && !member.isOwner ? (
                          <button
                            onClick={() => handleRemoveMember(member.userId)}
                            className="px-2 py-1 rounded border border-red-500/40 text-red-300 hover:bg-red-900/30 transition-colors"
                          >
                            Remove
                          </button>
                        ) : (
                          <span className="text-app-muted">{member.isOwner ? 'Owner' : '-'}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}