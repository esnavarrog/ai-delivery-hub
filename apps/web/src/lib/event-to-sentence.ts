import type { Artifact, TicketEvent } from '@ai-delivery-hub/domain';
import { riskTierLabels, runKindLabels, runFailureReasonLabels, ticketCategoryLabels, ticketFlagLabels } from '@/i18n/labels';
import { humanize } from './format';
import { describeSectionPath } from '@/features/plan/section-labels';

export interface Sentence {
  text: string;
  actorKind: TicketEvent['actor']['kind'];
  reason?: string;
  artifacts: Artifact[];
}

function actorName(actor: TicketEvent['actor']): string {
  if (actor.kind === 'ai') return 'la IA';
  if (actor.kind === 'system') return 'Sistema';
  return actor.id;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function runKindLabel(payload: Record<string, unknown>): string {
  const kind = str(payload['kind']);
  if (kind === 'triage') return runKindLabels.triage;
  if (kind === 'planning') return runKindLabels.planning;
  return 'IA';
}

const categoryLabel = (v: string | undefined): string | undefined => (v && v in ticketCategoryLabels ? ticketCategoryLabels[v as keyof typeof ticketCategoryLabels] : v);
const riskLabel = (v: string | undefined): string | undefined => (v && v in riskTierLabels ? riskTierLabels[v as keyof typeof riskTierLabels] : v);

/** Turns a domain event into a one-line, human sentence in Spanish. Unknown types fall back to a generic form. */
export function eventToSentence(event: TicketEvent): Sentence {
  const who = actorName(event.actor);
  const whoCapitalized = event.actor.kind === 'ai' ? 'La IA' : who;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const base = { actorKind: event.actor.kind, artifacts: event.artifacts, ...(event.reason !== undefined ? { reason: event.reason } : {}) };
  const type: string = event.type;

  switch (type) {
    case 'ticket_received': {
      const source = payload['source'] as { kind?: string } | undefined;
      if (source?.kind === 'manual') {
        return { ...base, text: payload['intake'] ? 'Solicitud recibida desde el formulario' : 'Ticket manual recibido' };
      }
      return { ...base, text: 'Ticket recibido desde OpenProject' };
    }
    case 'triage_started':
      return { ...base, text: 'La IA inició el triaje' };
    case 'triage_completed': {
      const parts = [categoryLabel(str(payload['category'])), riskLabel(str(payload['riskTier'])) ? `riesgo ${riskLabel(str(payload['riskTier']))}` : undefined, str(payload['targetRepo'])].filter(Boolean);
      return { ...base, text: parts.length > 0 ? `La IA terminó el triaje: ${parts.join(', ')}` : 'La IA terminó el triaje' };
    }
    case 'triage_confirmed': {
      const overrides = [
        categoryLabel(str(payload['category'])) ? `categoría ${categoryLabel(str(payload['category']))}` : undefined,
        riskLabel(str(payload['riskTier'])) ? `riesgo ${riskLabel(str(payload['riskTier']))}` : undefined,
        str(payload['targetRepo']) ? `repo ${str(payload['targetRepo'])}` : undefined,
      ].filter(Boolean);
      return { ...base, text: overrides.length > 0 ? `${whoCapitalized} confirmó el triaje con cambios: ${overrides.join(', ')}` : `${whoCapitalized} confirmó el triaje de la IA` };
    }
    case 'owner_required':
      return { ...base, text: 'Esperando a que una persona dev reclame el ticket' };
    case 'planning_started':
      return { ...base, text: 'La IA inició la planificación' };
    case 'ticket_claimed':
      return { ...base, text: `${str(payload['ownerUserId']) ?? whoCapitalized} reclamó el ticket` };
    case 'plan_version_created': {
      const v = num(payload['version']);
      return { ...base, text: v !== undefined ? `La IA creó el plan v${v}` : 'La IA creó una nueva versión del plan' };
    }
    case 'plan_changes_requested':
      return { ...base, text: `${whoCapitalized} solicitó cambios al plan` };
    case 'replan_requested':
      return { ...base, text: `${whoCapitalized} pidió a la IA que replanifique` };
    case 'plan_approved': {
      const second = str(payload['secondApproverId']);
      return { ...base, text: second ? `${whoCapitalized} aprobó el plan con ${second} como segundo aprobador` : `${whoCapitalized} aprobó el plan` };
    }
    case 'plan_reopened':
      return { ...base, text: `${whoCapitalized} reabrió el plan para revisión` };
    case 'ticket_rejected':
      return { ...base, text: `${whoCapitalized} rechazó el ticket` };
    case 'ticket_marked_duplicate': {
      const of = str(payload['duplicateOfTicketId']);
      return { ...base, text: of ? `${whoCapitalized} marcó el ticket como duplicado de ${of}` : `${whoCapitalized} marcó el ticket como duplicado` };
    }
    case 'ticket_marked_already_implemented':
      return { ...base, text: `${whoCapitalized} marcó el ticket como ya implementado` };
    case 'implementation_started':
      return { ...base, text: 'La IA inició la implementación' };
    case 'implementation_completed':
      return { ...base, text: 'La IA terminó la implementación' };
    case 'dev_review_approved':
      return { ...base, text: `${whoCapitalized} aprobó la revisión de la implementación` };
    case 'sandbox_qa_passed':
      return { ...base, text: `${whoCapitalized} aprobó el QA en sandbox` };
    case 'sandbox_qa_failed':
      return { ...base, text: `${whoCapitalized} reprobó el QA en sandbox` };
    case 'qa_fix_submitted':
      return { ...base, text: `${whoCapitalized} envió una corrección de QA` };
    case 'staging_qa_passed':
      return { ...base, text: `${whoCapitalized} aprobó el QA en staging` };
    case 'flag_set': {
      const flag = str(payload['flag']);
      const label = flag && flag in ticketFlagLabels ? ticketFlagLabels[flag as keyof typeof ticketFlagLabels].toLowerCase() : humanize(flag ?? 'desconocida');
      return { ...base, text: `${whoCapitalized} activó la marca ${label}` };
    }
    case 'flag_cleared': {
      const flag = str(payload['flag']);
      const label = flag && flag in ticketFlagLabels ? ticketFlagLabels[flag as keyof typeof ticketFlagLabels].toLowerCase() : humanize(flag ?? 'desconocida');
      return { ...base, text: `${whoCapitalized} quitó la marca ${label}` };
    }
    case 'plan_comment_added': {
      const section = str(payload['sectionPath']);
      return { ...base, text: section ? `${whoCapitalized} comentó en ${describeSectionPath(section)}` : `${whoCapitalized} comentó en el plan` };
    }
    case 'plan_comment_resolved':
      return { ...base, text: `${whoCapitalized} resolvió un comentario del plan` };
    case 'run_started':
      return { ...base, text: `Ejecución de ${runKindLabel(payload)} iniciada` };
    case 'run_succeeded':
      return { ...base, text: `Ejecución de ${runKindLabel(payload)} exitosa` };
    case 'run_failed': {
      const reason = str(payload['failureReason']);
      const label = reason && reason in runFailureReasonLabels ? runFailureReasonLabels[reason as keyof typeof runFailureReasonLabels] : (reason ? humanize(reason) : undefined);
      return { ...base, text: label ? `Ejecución de ${runKindLabel(payload)} falló: ${label}` : `Ejecución de ${runKindLabel(payload)} falló` };
    }
    case 'budget_exhausted':
      return { ...base, text: `Ejecución de ${runKindLabel(payload)} detenida: presupuesto agotado` };
    case 'requester_questions_asked': {
      const round = num(payload['round']);
      const count = Array.isArray(payload['questions']) ? payload['questions'].length : undefined;
      return { ...base, text: count !== undefined && round !== undefined ? `La IA hizo ${count} preguntas al solicitante (ronda ${round})` : 'La IA hizo preguntas al solicitante' };
    }
    case 'requester_answers_submitted': {
      const round = num(payload['round']);
      return { ...base, text: round !== undefined ? `${whoCapitalized} respondió las preguntas de la ronda ${round}` : `${whoCapitalized} respondió las preguntas del solicitante` };
    }
    case 'op_sync_posted':
      return { ...base, text: 'Actualización publicada en OpenProject' };
    case 'ticket_updated_from_op': {
      const fields = Array.isArray(payload['changedFields']) ? (payload['changedFields'] as string[]).join(' y ') : undefined;
      return { ...base, text: fields ? `OpenProject actualizó ${fields}` : 'OpenProject actualizó el paquete de trabajo' };
    }
    default:
      return { ...base, text: `${whoCapitalized} registró ${humanize(type)}` };
  }
}
