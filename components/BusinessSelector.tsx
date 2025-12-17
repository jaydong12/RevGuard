'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

export interface BusinessOption {
  id: string;
  name: string;
}

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
}

export function BusinessSelector({ value, onChange }: Props) {
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [warning, setWarning] = useState<string | null>(null);

  // Load businesses from public.business
  useEffect(() => {
    let mounted = true;

    async function loadBusinesses() {
      setLoading(true);
      setError(null);
      setWarning(null);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const userId = sess.session?.user?.id ?? null;

        // Prefer owner-scoped selection; fall back if owner_id doesn't exist yet.
        let res = userId
          ? await supabase
              .from('business')
              .select('id, name, created_at, owner_id')
              .eq('owner_id', userId)
              .order('created_at', { ascending: true })
          : await supabase
              .from('business')
              .select('id, name, created_at')
              .order('created_at', { ascending: true });

        if (res.error && userId) {
          const msg = String((res.error as any)?.message ?? '');
          if (msg.includes('owner_id')) {
            // owner_id column not migrated yet.
            res = await supabase
              .from('business')
              .select('id, name, created_at')
              .order('created_at', { ascending: true });
          }
        }

        const data = res.data;
        const error = res.error as any;

        if (!mounted) return;

        if (error) {
          // eslint-disable-next-line no-console
          console.error('BUSINESS_SELECTOR_LOAD_ERROR', error);
          setError('Could not load businesses.');
          setBusinesses([]);
          return;
        }

        const rows = (data ?? []) as { id: string; name: string | null }[];
        const mapped: BusinessOption[] = rows.map((row) => ({
          id: row.id,
          name: row.name || 'Untitled business',
        }));
        setBusinesses(mapped);

        // Enforce single-business UX: always use the first business if present.
        if (mapped.length >= 1) {
          if (!value || value !== mapped[0].id) onChange(mapped[0].id);
        }
        if (mapped.length > 1) {
          setWarning(
            'Multiple businesses detected. RevGuard Pro supports 1 business per account; using the first business.'
          );
        }
      } catch (err) {
        if (!mounted) return;
        // eslint-disable-next-line no-console
        console.error('BUSINESS_SELECTOR_UNEXPECTED', err);
        setError('Could not load businesses.');
        setBusinesses([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadBusinesses();

    return () => {
      mounted = false;
    };
  }, [onChange, value]);

  async function handleCreateBusiness(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;

    setError(null);
    setWarning(null);

    // Enforce 1 business per account.
    if (businesses.length >= 1) {
      setError('Only 1 business is supported. Delete extra businesses to continue.');
      return;
    }
    try {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id ?? null;

      const { data, error } = await supabase
        .from('business')
        .insert(userId ? { name, owner_id: userId } : { name })
        .select('id, name')
        .single();

      if (error || !data) {
        // eslint-disable-next-line no-console
        console.error('BUSINESS_CREATE_ERROR', error);
        setError(error?.message ?? 'Could not create business.');
        return;
      }

      const created: BusinessOption = {
        id: (data as any).id as string,
        name: ((data as any).name as string) || name,
      };

      setBusinesses((prev) => [...prev, created]);
      setNewName('');
      onChange(created.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('BUSINESS_CREATE_UNEXPECTED', err);
      setError('Could not create business.');
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-[11px] min-w-[220px]">
      <div className="flex items-center gap-1">
        <span className="text-slate-400 mr-1">Business:</span>
        <div className="flex-1 text-[11px] text-slate-100">
          {loading
            ? 'Loading…'
            : businesses.length === 0
              ? 'No business yet'
              : businesses[0]?.name}
        </div>
      </div>
      <form
        onSubmit={handleCreateBusiness}
        className="flex items-center gap-1 mt-1"
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={businesses.length >= 1 ? '1 business per account' : 'New business name'}
          disabled={businesses.length >= 1}
          className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <button
          type="submit"
          disabled={businesses.length >= 1}
          className="rounded border border-emerald-500/60 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/10"
        >
          Create
        </button>
      </form>
      {warning && (
        <p className="text-[10px] text-amber-300 mt-0.5">{warning}</p>
      )}
      {error && (
        <p className="text-[10px] text-rose-400 mt-0.5">{error}</p>
      )}
    </div>
  );
}
