import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { supabase, hasSupabase, SITE_URL } from '../lib/supabase';
import { humanizeError } from '../lib/errors';
import { Button } from '../components/ui/Button';

export function ResetPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasSupabase) {
      setError('Backend não configurado.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: rstErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${SITE_URL}/login`,
    });
    setSubmitting(false);
    if (rstErr) {
      setError(humanizeError(rstErr));
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy via-purple to-magenta p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-elevated dark:bg-card-dark">
        <img src="/logos/logo-color.svg" className="mx-auto h-12" alt="geoCon" />
        <h1 className="mt-6 text-center text-xl font-bold text-slate-900 dark:text-slate-100">Recuperar senha</h1>
        <p className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
          Enviaremos um link de redefinição para o seu e-mail.
        </p>

        {sent ? (
          <div className="mt-8 space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Se este e-mail está cadastrado, você receberá um link em alguns minutos.
            </p>
            <Link to="/login" className="text-sm text-navy hover:underline dark:text-slate-300">
              Voltar para login
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="email" className="label">E-mail</label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input pl-10"
                    placeholder="voce@empresa.com.br"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                  {error}
                </div>
              )}

              <Button type="submit" variant="primary" className="w-full" loading={submitting} disabled={!email}>
                Enviar link
              </Button>
            </form>

            <Link to="/login" className="mt-6 flex items-center justify-center gap-1 text-sm text-slate-500 hover:text-navy dark:text-slate-400">
              <ArrowLeft className="h-4 w-4" />
              Voltar para login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
