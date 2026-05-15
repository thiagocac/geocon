import { useQuery } from '@tanstack/react-query';
import { Plus, Users, Briefcase, ShieldCheck, BookOpen } from 'lucide-react';
import { supabase, hasSupabase } from '../../lib/supabase';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Empty, Skeleton } from '../../components/ui/Stat';

export function AdminUsers() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'members'],
    queryFn: async () => {
      if (!hasSupabase) return [];
      const { data, error } = await supabase
        .from('members')
        .select('*, tenants(nome)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  return (
    <Layout>
      <PageHeader
        title="Usuários e papéis"
        subtitle="Gestão de membros do tenant, papéis e permissões por produto"
        actions={<Button><Plus className="h-4 w-4" />Convidar usuário</Button>}
      />
      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
      {!isLoading && data.length === 0 && <Empty title="Sem usuários" />}
      {data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Tenant</th><th>Papel</th><th>Roles</th><th>Ativo</th></tr></thead>
            <tbody>
              {data.map((m: any) => (
                <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                  <td className="font-medium">{m.nome}</td>
                  <td className="text-sm text-slate-500 dark:text-slate-400">{m.email}</td>
                  <td className="text-xs">{m.tenants?.nome || '—'}</td>
                  <td><Badge tone="purple">{m.role}</Badge></td>
                  <td className="text-xs text-slate-500 dark:text-slate-400">
                    {(m.roles || []).join(', ') || '—'}
                  </td>
                  <td>{m.active ? <Badge tone="green">Sim</Badge> : <Badge tone="slate">Não</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}

export function AdminTenants() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: async () => {
      if (!hasSupabase) return [];
      const { data, error } = await supabase.from('tenants').select('*').order('nome');
      if (error) throw new Error(error.message);
      return data || [];
    },
  });
  return (
    <Layout>
      <PageHeader
        title="Tenants"
        subtitle="Espelho local dos tenants vindos do identity hub"
        actions={<Button variant="outline">Sincronizar identity</Button>}
      />
      {isLoading && <Skeleton className="h-32" />}
      {!isLoading && data.length === 0 && <Empty title="Sem tenants cadastrados" body="Sincronize com o identity hub." />}
      {data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead><tr><th>Nome</th><th>CNPJ</th><th>Ativo</th><th>ID</th></tr></thead>
            <tbody>
              {data.map((t: any) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.nome}</td>
                  <td className="text-xs">{t.cnpj || '—'}</td>
                  <td>{t.ativo ? <Badge tone="green">Ativo</Badge> : <Badge tone="slate">Inativo</Badge>}</td>
                  <td className="font-mono text-xs text-slate-400">{t.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}

export function Workflows() {
  return (
    <Layout>
      <PageHeader
        title="Templates de workflow"
        subtitle="Configure passos, papéis, SLA e regras de aprovação para medições, aditivos e itens não previstos"
        actions={<Button><Plus className="h-4 w-4" />Novo template</Button>}
      />
      <Empty title="Sem templates configurados" body="Cadastre um template para aplicar a contratos." />
    </Layout>
  );
}

export function Backlog() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'backlog'],
    queryFn: async () => {
      if (!hasSupabase) return [];
      const { data, error } = await supabase.from('admin_backlog').select('*').order('numero', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });
  return (
    <Layout>
      <PageHeader title="Backlog interno" subtitle="Pendências, melhorias e bugs visíveis apenas para admins"
        actions={<Button><Plus className="h-4 w-4" />Adicionar item</Button>} />
      {isLoading && <Skeleton className="h-32" />}
      {!isLoading && data.length === 0 && <Empty title="Backlog vazio" />}
      {data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead><tr><th>#</th><th>Título</th><th>Categoria</th><th>Prioridade</th><th>Status</th></tr></thead>
            <tbody>
              {data.map((b: any) => (
                <tr key={b.id}>
                  <td className="font-mono text-xs">{b.numero}</td>
                  <td><p className="font-medium">{b.titulo}</p><p className="text-xs text-slate-500 dark:text-slate-400">{b.descricao}</p></td>
                  <td className="text-xs uppercase">{b.categoria}</td>
                  <td><Badge tone={b.prioridade === 'alta' ? 'red' : b.prioridade === 'media' ? 'yellow' : 'slate'}>{b.prioridade}</Badge></td>
                  <td><Badge tone={b.status === 'concluido' ? 'green' : b.status === 'em_andamento' ? 'blue' : 'slate'}>{b.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}
