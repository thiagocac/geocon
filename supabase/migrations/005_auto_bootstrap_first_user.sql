-- =============================================================================
-- 005_auto_bootstrap_first_user.sql
--
-- Cria um trigger em auth.users (AFTER INSERT) que automaticamente:
--   (a) Cria um tenant "Tenant Inicial" se nenhum existir.
--   (b) Cria um members com role='admin' para o primeiro usuário.
--   (c) Para usuários subsequentes, faz nada (precisam ser convidados).
--
-- Isso resolve o problema de "ovo e galinha" do primeiro signup: o usuário
-- consegue entrar no app sem precisar editar SQL manualmente. Depois, o
-- admin pode criar tenants/convidar usuários pelo painel /admin.
--
-- Idempotente: o trigger checa COUNT(*) antes de criar tenant/admin.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_tenant_count integer;
  v_member_count integer;
  v_tenant_id    uuid;
  v_user_email   text;
  v_user_nome    text;
BEGIN
  -- Apenas para inserts reais em auth.users (não tocados pelo Supabase Admin)
  v_user_email := NEW.email;
  IF v_user_email IS NULL OR v_user_email = '' THEN
    RETURN NEW;
  END IF;

  -- Calcula nome a partir do e-mail (parte antes do @)
  v_user_nome := initcap(replace(split_part(v_user_email, '@', 1), '.', ' '));

  SELECT count(*) INTO v_member_count
  FROM public.members
  WHERE auth_id = NEW.id;

  -- Se já tem member (caso convidado), nada a fazer.
  IF v_member_count > 0 THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_tenant_count FROM public.tenants WHERE ativo = true;

  IF v_tenant_count = 0 THEN
    -- Primeiro usuário no sistema: bootstrap completo.
    -- tenants.id e members.id não têm DEFAULT — preciso passar gen_random_uuid() explícito
    INSERT INTO public.tenants (id, nome, ativo, cnpj)
    VALUES (gen_random_uuid(), 'Organização inicial', true, NULL)
    RETURNING id INTO v_tenant_id;

    INSERT INTO public.members (
      id, auth_id, tenant_id, email, nome, role, roles, active
    ) VALUES (
      gen_random_uuid(), NEW.id, v_tenant_id, v_user_email, v_user_nome,
      'admin', ARRAY['admin']::text[], true
    );

    -- Seed de índices de reajuste para o novo tenant (IPCA, IGP-M, INCC, SINAPI)
    BEGIN
      PERFORM public.seed_adjustment_indices(v_tenant_id);
    EXCEPTION WHEN OTHERS THEN
      -- Função pode não existir em instalações sem migration 004; ignore.
      NULL;
    END;

    RAISE NOTICE '[bootstrap] Tenant % criado com admin % (%)',
                 v_tenant_id, NEW.id, v_user_email;
  ELSE
    -- Já existe tenant. Não fazemos nada: o usuário precisa ser convidado
    -- explicitamente por um admin para virar member de algum tenant.
    -- O app vai mostrar tela "Sem acesso — peça convite ao administrador".
    RAISE NOTICE '[bootstrap] Usuário % criado sem member (precisa de convite)',
                 v_user_email;
  END IF;

  RETURN NEW;
END;
$$;

-- O trigger precisa rodar como owner (postgres) para inserir em public.tenants
-- ignorando RLS. SECURITY DEFINER acima já cuida disso.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- =============================================================================
-- Conveniência: função para o admin promover/convidar um usuário existente
-- de auth.users para um tenant específico, com role escolhido.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.invite_existing_user(
  p_email   text,
  p_tenant_id uuid,
  p_role    text DEFAULT 'viewer'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_auth_id  uuid;
  v_member_id uuid;
BEGIN
  -- Verifica se quem está chamando é admin do tenant alvo
  IF NOT EXISTS (
    SELECT 1 FROM public.members
    WHERE auth_id = auth.uid()
      AND tenant_id = p_tenant_id
      AND 'admin' = ANY(roles)
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Apenas admins do tenant podem convidar usuários';
  END IF;

  SELECT id INTO v_auth_id FROM auth.users WHERE email = p_email;
  IF v_auth_id IS NULL THEN
    RAISE EXCEPTION 'Usuário com e-mail % não existe em auth.users. Peça que se cadastre antes.', p_email;
  END IF;

  INSERT INTO public.members (
    id, auth_id, tenant_id, email, nome, role, roles, active
  ) VALUES (
    gen_random_uuid(), v_auth_id, p_tenant_id, p_email,
    initcap(replace(split_part(p_email, '@', 1), '.', ' ')),
    p_role, ARRAY[p_role]::text[], true
  )
  ON CONFLICT (auth_id, tenant_id) DO UPDATE
    SET role = EXCLUDED.role,
        roles = EXCLUDED.roles,
        active = true,
        deleted_at = NULL
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_existing_user(text, uuid, text) TO authenticated;
