-- =============================================================================
-- 064_ged_revision_workflow_notifications
-- =============================================================================
-- Ativa V60 (workflow aprovação revisão GED) na prática.
--
-- V60 deixou o workflow funcional mas passivo: sem notificação, o assigned_to
-- só descobre que tem step pendente se navegar manualmente para o documento.
-- V65 adiciona 2 triggers:
--
--   1. AFTER INSERT em ged_revision_approval_steps:
--      - Cria notification 'workflow_assignment' para assigned_to
--      - Link direto para página de aprovação
--
--   2. AFTER UPDATE em ged_revision_approval_steps (status mudou):
--      - Aprovado: notifica próximo step pendente (ordem ASC) + autor da revisão
--      - Devolvido/Reprovado: notifica autor da revisão (uploader)
--
-- Não envia email/webhook nessa versão — só popula tabela `notifications`.
-- Webhook integration via notification_preferences (V20) já está pronta;
-- usuário com pref ativada recebe via Slack/email automaticamente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_ged_revision_step_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc_title text;
  v_rev       text;
  v_link      text;
BEGIN
  -- Só notifica em INSERT (criação inicial do step)
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.assigned_to IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'pendente' THEN RETURN NEW; END IF;

  SELECT d.title, v.revision INTO v_doc_title, v_rev
    FROM public.ged_documents d
    LEFT JOIN public.ged_document_versions v ON v.id = NEW.version_id
   WHERE d.id = NEW.document_id;

  v_link := '/ged/documentos/' || NEW.document_id::text || '/aprovar';

  PERFORM public.notify_recipient(
    NEW.assigned_to,
    'Revisão GED aguardando sua aprovação',
    coalesce(v_doc_title, 'documento') || ' · revisão ' || coalesce(v_rev, '?')
      || ' · etapa "' || NEW.nome || '"',
    v_link,
    'workflow_assignment',
    jsonb_build_object(
      'entity_type', 'ged_revision_step',
      'step_id',     NEW.id,
      'document_id', NEW.document_id,
      'version_id',  NEW.version_id,
      'ordem',       NEW.ordem,
      'due_at',      NEW.due_at
    )
  );

  RETURN NEW;
END;
$$;

-- =============================================================================
-- Trigger UPDATE — notifica autor da revisão e próximo aprovador
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_ged_revision_step_decided()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc_title    text;
  v_rev          text;
  v_uploaded_by  uuid;
  v_link         text;
  v_next_step    record;
  v_decided_nome text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  -- Só dispara quando status sai de 'pendente' para algo diferente
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF OLD.status <> 'pendente' THEN RETURN NEW; END IF;

  SELECT d.title, v.revision, v.uploaded_by
    INTO v_doc_title, v_rev, v_uploaded_by
    FROM public.ged_documents d
    LEFT JOIN public.ged_document_versions v ON v.id = NEW.version_id
   WHERE d.id = NEW.document_id;

  SELECT nome INTO v_decided_nome
    FROM public.members WHERE id = NEW.decided_by LIMIT 1;

  v_link := '/ged/documentos/' || NEW.document_id::text || '/aprovar';

  IF NEW.status = 'aprovado' THEN
    -- Aprovado: busca próximo step pendente na mesma versão
    SELECT * INTO v_next_step
      FROM public.ged_revision_approval_steps
     WHERE version_id = NEW.version_id
       AND status = 'pendente'
       AND deleted_at IS NULL
     ORDER BY ordem ASC
     LIMIT 1;

    IF v_next_step.id IS NOT NULL AND v_next_step.assigned_to IS NOT NULL THEN
      -- Notifica próximo aprovador
      PERFORM public.notify_recipient(
        v_next_step.assigned_to,
        'Próxima etapa GED aguarda sua aprovação',
        coalesce(v_doc_title, 'documento') || ' · revisão ' || coalesce(v_rev, '?')
          || ' · etapa "' || v_next_step.nome || '" (anterior aprovada)',
        v_link,
        'workflow_assignment',
        jsonb_build_object(
          'entity_type', 'ged_revision_step',
          'step_id',     v_next_step.id,
          'document_id', NEW.document_id,
          'previous_step_id', NEW.id
        )
      );
    ELSE
      -- Último step aprovado → revisão publicada. Notifica autor.
      IF v_uploaded_by IS NOT NULL THEN
        PERFORM public.notify_recipient(
          v_uploaded_by,
          'Revisão GED publicada',
          coalesce(v_doc_title, 'documento') || ' · revisão ' || coalesce(v_rev, '?')
            || ' aprovada e publicada como vigente',
          '/ged/documentos/' || NEW.document_id::text,
          'success',
          jsonb_build_object(
            'entity_type', 'ged_revision_publish',
            'document_id', NEW.document_id,
            'version_id',  NEW.version_id
          )
        );
      END IF;
    END IF;

  ELSIF NEW.status IN ('devolvido', 'reprovado') THEN
    -- Devolução / reprovação → notifica autor da revisão
    IF v_uploaded_by IS NOT NULL THEN
      PERFORM public.notify_recipient(
        v_uploaded_by,
        CASE WHEN NEW.status = 'reprovado' THEN 'Revisão GED reprovada' ELSE 'Revisão GED devolvida para ajustes' END,
        coalesce(v_doc_title, 'documento') || ' · revisão ' || coalesce(v_rev, '?')
          || ' · etapa "' || NEW.nome || '"'
          || CASE WHEN v_decided_nome IS NOT NULL THEN ' · decidida por ' || v_decided_nome ELSE '' END
          || CASE WHEN NEW.comment IS NOT NULL THEN ' · "' || left(NEW.comment, 120) || '"' ELSE '' END,
        v_link,
        CASE WHEN NEW.status = 'reprovado' THEN 'error' ELSE 'warning' END,
        jsonb_build_object(
          'entity_type', 'ged_revision_step',
          'step_id',     NEW.id,
          'document_id', NEW.document_id,
          'decision',    NEW.status,
          'comment',     NEW.comment
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- Triggers — idempotente
-- =============================================================================
DROP TRIGGER IF EXISTS trg_notify_ged_revision_assigned  ON public.ged_revision_approval_steps;
DROP TRIGGER IF EXISTS trg_notify_ged_revision_decided   ON public.ged_revision_approval_steps;

CREATE TRIGGER trg_notify_ged_revision_assigned
  AFTER INSERT ON public.ged_revision_approval_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_ged_revision_step_assigned();

CREATE TRIGGER trg_notify_ged_revision_decided
  AFTER UPDATE ON public.ged_revision_approval_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_ged_revision_step_decided();

COMMENT ON FUNCTION public.notify_ged_revision_step_assigned() IS
'V65 — Ao inserir step de aprovação GED, notifica assigned_to. Reusa notify_recipient.';

COMMENT ON FUNCTION public.notify_ged_revision_step_decided() IS
'V65 — Ao decidir step de aprovação GED, notifica próximo aprovador (se aprovado) ' ||
'ou autor da revisão (devolvido/reprovado/publicada).';
