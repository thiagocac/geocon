/**
 * check-sla-overdue — cron job. Varre approval_steps com SLA vencido e
 * (a) marca workflow_step_overdue=true e (b) cria notificações para
 * os escalation_recipients configurados.
 *
 * Agendar via pg_cron a cada hora ou via supabase functions schedule.
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, serverError } from '../_shared/response.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const svc = getServiceClient();
    const now = new Date().toISOString();

    const { data: overdue, error } = await svc
      .from('approval_steps')
      .select('id, workflow_instance_id, step_name, sla_due_at, escalation_member_id, tenant_id, workflow_instances(entity_type,entity_id)')
      .eq('status', 'pending')
      .lt('sla_due_at', now)
      .eq('overdue_notified', false)
      .is('deleted_at', null)
      .limit(200);

    if (error) throw error;

    const processed: Array<{ step_id: string; notified: boolean }> = [];

    for (const step of overdue || []) {
      const wf = step.workflow_instances;
      const entity = wf?.entity_type || 'workflow';
      const entityId = wf?.entity_id || step.workflow_instance_id;

      // Atualiza flag
      await svc.from('approval_steps').update({ overdue_notified: true }).eq('id', step.id);

      // Cria notificação
      if (step.escalation_member_id) {
        await svc.from('notifications').insert({
          tenant_id: step.tenant_id,
          recipient_member_id: step.escalation_member_id,
          title: `SLA vencido — ${step.step_name}`,
          body: `O passo "${step.step_name}" do ${entity} ${entityId} excedeu o SLA. Verifique e aja conforme escalação.`,
          link: `/contratos`,
          kind: 'sla_overdue',
        });
      }

      processed.push({ step_id: step.id, notified: !!step.escalation_member_id });
    }

    return ok({ checked_at: now, overdue_count: overdue?.length || 0, processed });
  } catch (e) {
    return serverError(e);
  }
});
