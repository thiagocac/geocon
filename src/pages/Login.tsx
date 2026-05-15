import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, Lock, AlertCircle, CheckCircle2, User as UserIcon } from 'lucide-react';
import {
  supabase, hasSupabase, PRODUCT_LONG_NAME,
} from '../lib/supabase';
import { humanizeError } from '../lib/errors';
import { Button } from '../components/ui/Button';

type Mode = 'signin' | 'signup';

export function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from || '/dashboard';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!hasSupabase) {
      setError(
        'Backend não configurado. Edite /config.js e preencha SUPABASE_ANON_KEY com a chave anon do seu projeto Supabase.',
      );
      return;
    }

    setSubmitting(true);

    if (mode === 'signin') {
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setSubmitting(false);
      if (signErr) {
        setError(humanizeError(signErr));
        return;
      }
      navigate(from, { replace: true });
      return;
    }

    // SIGNUP
    const { data, error: signErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Após confirmar e-mail, redireciona para login automaticamente.
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    setSubmitting(false);

    if (signErr) {
      setError(humanizeError(signErr));
      return;
    }

    // Quando "Confirm email" está habilitado no Supabase, data.session === null
    // e o usuário precisa abrir o link do e-mail. Caso contrário, já está logado.
    if (data.session) {
      setInfo('Conta criada e sessão iniciada. Redirecionando…');
      setTimeout(() => navigate(from, { replace: true }), 600);
    } else {
      setInfo(
        'Conta criada. Verifique sua caixa de entrada e clique no link de confirmação. ' +
        'Depois volte e use "Entrar".',
      );
      setMode('signin');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy via-purple to-magenta p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-elevated dark:bg-card-dark">
        <div className="text-center">
          <img src="/logos/logo-color.svg" className="mx-auto h-16" alt="geoCon" />
          <h1 className="mt-6 text-2xl font-bold text-slate-900 dark:text-slate-100">
            <span className="text-magenta">°</span>geoCon
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{PRODUCT_LONG_NAME}</p>
        </div>

        {/* Toggle signin/signup */}
        <div className="mt-6 flex rounded-xl bg-slate-100 p-1 dark:bg-muted-dark">
          {(['signin', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); setInfo(null); }}
              className={[
                'flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
                mode === m
                  ? 'bg-white text-navy shadow-sm dark:bg-card-dark dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200',
              ].join(' ')}
            >
              {m === 'signin' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>

        {/* Aviso de backend não configurado — destaque visual */}
        {!hasSupabase && (
          <div className="mt-4 rounded-lg bg-yellow-50 p-3 text-xs text-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-200">
            <p className="font-bold uppercase tracking-wider">⚠ Backend não configurado</p>
            <p className="mt-1 leading-relaxed">
              O arquivo <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/40">/config.js</code> ainda contém o placeholder <code>REPLACE_WITH_YOUR_ANON_KEY</code>.
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-0.5">
              <li>Abra Supabase Studio → Settings → API Keys.</li>
              <li>Copie a chave <strong>anon public</strong>.</li>
              <li>No Netlify, abra Site → Files → <code>config.js</code> e cole.</li>
            </ol>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="label">E-mail</label>
            <div className="relative mt-1">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="input pl-10" placeholder="voce@empresa.com.br"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="label">Senha</label>
              {mode === 'signin' && (
                <Link to="/reset-password" className="text-xs text-navy hover:underline dark:text-slate-300">
                  Esqueci a senha
                </Link>
              )}
            </div>
            <div className="relative mt-1">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="password" type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required minLength={mode === 'signup' ? 8 : 1}
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="input pl-10"
                placeholder={mode === 'signup' ? 'mínimo 8 caracteres' : '••••••••'}
              />
            </div>
            {mode === 'signup' && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Mínimo 8 caracteres. A primeira conta vira admin automaticamente.
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {info && (
            <div className="flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{info}</span>
            </div>
          )}

          <Button
            type="submit" variant="primary" className="w-full"
            loading={submitting} disabled={!email || !password}
          >
            {mode === 'signin' ? 'Entrar' : 'Criar conta'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
          Plataforma Consulte GEO · geoCon · geoRDO · geoFin
        </p>
      </div>
    </div>
  );
}
