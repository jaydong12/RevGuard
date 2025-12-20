'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../utils/supabaseClient';

type AdminMe = {
  isAdmin: boolean;
};

type ListedUser = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
};

export default function AdminUsersPage() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [me, setMe] = useState<AdminMe | null>(null);
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!mounted) return;
      setSessionToken(token);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setError(null);
      setMe(null);
      setUsers([]);
      if (!sessionToken) return;
      setLoading(true);
      try {
        const meRes = await fetch('/api/admin/me', {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        const meBody = (await meRes.json()) as AdminMe;
        if (!mounted) return;
        setMe(meBody);
        if (!meRes.ok || !meBody.isAdmin) {
          setLoading(false);
          return;
        }

        const res = await fetch('/api/admin/users', {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        const body = (await res.json()) as { users?: ListedUser[]; error?: string };
        if (!mounted) return;
        if (!res.ok) throw new Error(body.error || 'Failed to load users.');
        setUsers(body.users ?? []);
      } catch (e: any) {
        if (!mounted) return;
        setError(String(e?.message ?? 'Failed to load admin data.'));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [sessionToken]);

  const sorted = useMemo(() => {
    return [...users].sort((a, b) => {
      const ae = (a.email ?? '').toLowerCase();
      const be = (b.email ?? '').toLowerCase();
      return ae.localeCompare(be);
    });
  }, [users]);

  function openDelete(u: ListedUser) {
    setDeletingUserId(u.id);
    setConfirmText('');
    setConfirmOpen(true);
  }

  async function runDelete() {
    if (!sessionToken || !deletingUserId) return;
    if (confirmText.trim() !== 'DELETE') return;

    setDeleteBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/hard-delete-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ user_id: deletingUserId, confirm: 'DELETE' }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || 'Delete failed.');
      }

      setUsers((prev) => prev.filter((u) => u.id !== deletingUserId));
      setConfirmOpen(false);
      setDeletingUserId(null);
    } catch (e: any) {
      setError(String(e?.message ?? 'Delete failed.'));
    } finally {
      setDeleteBusy(false);
    }
  }

  if (!sessionToken) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <div className="text-sm text-slate-400">Please log in.</div>
      </main>
    );
  }

  if (loading && !me) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <div className="text-sm text-slate-400">Loading…</div>
      </main>
    );
  }

  if (me && !me.isAdmin) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
          <div className="text-sm text-slate-200 font-semibold">Not authorized</div>
          <div className="mt-1 text-xs text-slate-400">
            This page is only visible to admins.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
            Admin
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-50">
            Users
          </h1>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/40">
        <table className="min-w-full text-sm">
          <thead className="text-xs text-slate-400 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">User ID</th>
              <th className="px-4 py-3 text-left">Created</th>
              <th className="px-4 py-3 text-left">Last sign-in</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sorted.map((u) => (
              <tr key={u.id} className="text-slate-200">
                <td className="px-4 py-3">{u.email ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-300">
                  {u.id}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {u.created_at ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {u.last_sign_in_at ?? '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => openDelete(u)}
                    className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/15"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-xs text-slate-500"
                >
                  No users returned.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5">
            <div className="text-sm font-semibold text-slate-100">
              Delete user
            </div>
            <div className="mt-1 text-xs text-slate-400">
              This permanently deletes the user, their businesses, and all related data.
              Type <span className="font-mono text-slate-200">DELETE</span> to confirm.
            </div>

            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="mt-4 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (deleteBusy) return;
                  setConfirmOpen(false);
                  setDeletingUserId(null);
                }}
                className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmText.trim() !== 'DELETE' || deleteBusy}
                onClick={runDelete}
                className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}


