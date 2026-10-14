import type { Metadata, ModelDef } from '@osuite/kernel';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setToken } from './api.ts';

export function useBootstrap() {
  return useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap, staleTime: 60_000 });
}

/** Bootstrap data for a signed-in user; only call below the session gate. */
export function useSession() {
  const { data } = useBootstrap();
  if (!data?.user) throw new Error('useSession used outside a signed-in session');
  return { ...data, user: data.user };
}

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity });
}

export function useModel(name: string | undefined): ModelDef | undefined {
  const { data } = useMeta();
  return name ? (data as Metadata | undefined)?.models[name] : undefined;
}

/** Models users create directly (excludes read-only ledgers and document lines). */
export function creatableModels(meta: Metadata | undefined): ModelDef[] {
  if (!meta) return [];
  const owned = new Set(
    Object.values(meta.models).flatMap((m) => Object.values(m.fields).flatMap((f) => (f.type === 'lines' ? [f.model] : []))),
  );
  return Object.values(meta.models).filter((m) => !m.readonly && !owned.has(m.name));
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await api.logout().catch(() => undefined);
    setToken(null);
    qc.clear();
    window.location.assign('/');
  };
}
