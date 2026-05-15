import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Skeleton } from '../ui/Stat';

interface Props {
  children: ReactNode;
  roles?: string[];
}

export function ProtectedRoute({ children, roles }: Props) {
  const { loading, authenticated, member, hasRole } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-background-dark">
        <div className="space-y-3 text-center">
          <Skeleton className="h-8 w-32" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando sessão…</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!member) {
    return <Navigate to="/no-access" replace />;
  }

  if (roles && roles.length > 0 && !hasRole(roles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
