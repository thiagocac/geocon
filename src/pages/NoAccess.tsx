import { Link } from 'react-router-dom';
import { ShieldAlert, LogOut, Mail } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';

/**
 * Tela mostrada quando o usuário está autenticado em auth.users mas não tem
 * registro correspondente em public.members. Acontece quando:
 *   (a) Migration 005 (bootstrap automático) não foi aplicada e este é o
 *       primeiro signup.
 *   (b) Já existem outros tenants e o admin não convidou este usuário ainda.
 *
 * Cenário (a) é o que o operador encontra na primeira instalação — damos
 * instruções para aplicar a migration ou criar o admin manualmente.
 */
export function NoAccess() {
  const { signOut, member } = useAuth();

  // Se já temos member, esta tela não deveria estar visível — manda para o dashboard.
  if (member) {
    window.location.href = '/dashboard';
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy via-purple to-magenta p-6">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-elevated dark:bg-card-dark">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
          <ShieldAlert className="h-7 w-7 text-yellow-600 dark:text-yellow-300" />
        </div>

        <h1 className="mt-5 text-2xl font-bold text-slate-900 dark:text-slate-100">
          Conta sem acesso a tenants
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Sua autenticação funcionou, mas você ainda não está vinculado a nenhuma
          organização (tenant) neste geoCon.
        </p>

        <div className="mt-6 space-y-4 text-sm">
          <section className="rounded-xl border border-slate-200 p-4 dark:border-border-dark">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              Se você é o operador (primeira instalação):
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1.5 text-slate-600 dark:text-slate-300">
              <li>
                Aplique a migration <code className="rounded bg-slate-100 px-1.5 dark:bg-muted-dark">005_auto_bootstrap_first_user.sql</code> via
                Supabase CLI (<code>supabase db push</code>) ou cole no SQL Editor.
              </li>
              <li>
                Faça logout, apague sua conta em <code className="rounded bg-slate-100 px-1.5 dark:bg-muted-dark">auth.users</code> e cadastre-se novamente — o trigger criará tenant + admin.
              </li>
              <li>
                Ou, mais rápido: rode no SQL Editor:
                <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-2 font-mono text-[11px] leading-relaxed text-slate-100">
{`INSERT INTO public.tenants (nome, ativo) VALUES ('Sua Org', true)
RETURNING id;
-- copie o id e:
INSERT INTO public.members (auth_id, tenant_id, email, nome, role, roles, active)
SELECT id, '<UUID_DO_TENANT>', email, split_part(email, '@', 1), 'admin', ARRAY['admin'], true
FROM auth.users WHERE email = '<SEU_EMAIL>';`}
                </pre>
              </li>
            </ol>
          </section>

          <section className="rounded-xl border border-slate-200 p-4 dark:border-border-dark">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              <Mail className="mr-1 inline h-4 w-4" />
              Se você é um usuário convidado:
            </p>
            <p className="mt-2 text-slate-600 dark:text-slate-300">
              Peça ao administrador da sua organização para te convidar pelo
              painel <code className="rounded bg-slate-100 px-1.5 dark:bg-muted-dark">/admin/users</code>, ou rodar:
            </p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-2 font-mono text-[11px] text-slate-100">
{`select invite_existing_user('seu@email.com', '<tenant_id>', 'viewer');`}
            </pre>
          </section>
        </div>

        <div className="mt-6 flex gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>
            Verificar novamente
          </Button>
          <Button variant="ghost" onClick={() => signOut()}>
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
          <Link to="/login" className="hover:underline">Voltar para login</Link>
        </p>
      </div>
    </div>
  );
}
