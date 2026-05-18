import { useEffect, useState, useCallback, createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { supabase, hasSupabase, SKIP_AUTH } from '../lib/supabase';
import { MOCK_MEMBER } from '../lib/mockData';
import type { Member } from '../lib/types';

interface AuthState {
  loading: boolean;
  authenticated: boolean;
  member: Member | null;
  members: Member[];
  switchMember: (memberId: string) => Promise<void>;
  signOut: () => Promise<void>;
  hasRole: (roles: string[]) => boolean;
}

const Ctx = createContext<AuthState>({
  loading: true,
  authenticated: false,
  member: null,
  members: [],
  switchMember: async () => {},
  signOut: async () => {},
  hasRole: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  const loadMembers = useCallback(async (authId: string) => {
    if (!hasSupabase) {
      setMembers([]);
      setMember(null);
      return;
    }
    const { data, error } = await supabase
      .from('members')
      .select('*, tenants(id,nome,brand_logo_url)')
      .eq('auth_id', authId)
      .eq('active', true)
      .is('deleted_at', null)
      .order('created_at');

    if (error) {
      console.error('[useAuth] erro ao carregar members:', error);
      setMembers([]);
      setMember(null);
      return;
    }
    const list = (data || []) as Member[];
    setMembers(list);

    // Resgata membro ativo do localStorage; senão usa o primeiro
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_member') : null;
    const active = list.find((m) => m.id === stored) || list[0] || null;
    setMember(active);
    if (active && typeof window !== 'undefined') {
      window.localStorage.setItem('geocon:active_member', active.id);
      window.localStorage.setItem('geocon:active_tenant', active.tenant_id);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // Modo DEMO: usa mock e ignora Supabase Auth completamente.
    if (SKIP_AUTH) {
      setAuthenticated(true);
      setMember(MOCK_MEMBER);
      setMembers([MOCK_MEMBER]);
      setLoading(false);
      return () => { mounted = false; };
    }

    async function bootstrap() {
      if (!hasSupabase) {
        if (mounted) {
          setLoading(false);
          setAuthenticated(false);
        }
        return;
      }
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error || !data.session) {
        setAuthenticated(false);
        setMember(null);
        setLoading(false);
        return;
      }
      setAuthenticated(true);
      await loadMembers(data.session.user.id);
      if (mounted) setLoading(false);
    }

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !session) {
        setAuthenticated(false);
        setMember(null);
        setMembers([]);
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('geocon:active_member');
          window.localStorage.removeItem('geocon:active_tenant');
        }
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setAuthenticated(true);
        if (session?.user) {
          loadMembers(session.user.id);
        }
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadMembers]);

  const switchMember = useCallback(async (memberId: string) => {
    const m = members.find((x) => x.id === memberId);
    if (!m) return;
    setMember(m);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('geocon:active_member', m.id);
      window.localStorage.setItem('geocon:active_tenant', m.tenant_id);
    }
    // Recarrega a página para forçar TanStack Query a refetch com novo tenant.
    if (typeof window !== 'undefined') window.location.reload();
  }, [members]);

  const signOut = useCallback(async () => {
    if (SKIP_AUTH) {
      // Em demo, "sair" só recarrega — não há sessão real para limpar.
      if (typeof window !== 'undefined') window.location.href = '/login';
      return;
    }
    if (hasSupabase) await supabase.auth.signOut();
    setAuthenticated(false);
    setMember(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('geocon:active_member');
      window.localStorage.removeItem('geocon:active_tenant');
    }
  }, []);

  const hasRole = useCallback(
    (roles: string[]) => {
      if (!member) return false;
      if (roles.includes(member.role)) return true;
      return Array.isArray(member.roles) && member.roles.some((r) => roles.includes(r));
    },
    [member],
  );

  return (
    <Ctx.Provider value={{ loading, authenticated, member, members, switchMember, signOut, hasRole }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(Ctx);
}
