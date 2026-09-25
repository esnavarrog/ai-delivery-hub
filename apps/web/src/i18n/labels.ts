import type { ActorKind, Confidence, Department, Effort, Frequency, Role, RiskTier, RunFailureReason, TicketCategory, TicketFlag, TicketPriority, TicketState } from '@ai-delivery-hub/domain';
import type { RunKind, RunStatus } from '@ai-delivery-hub/contracts';

/** Spanish labels for every domain enum rendered in the UI. Keys stay the English enum values (contracts unchanged). */
export const ticketStateLabels: Record<TicketState, string> = {
  received: 'Recibido',
  triaging: 'En triaje',
  awaiting_requester: 'Esperando respuesta',
  triaged: 'Triaje listo',
  awaiting_owner: 'Esperando responsable',
  planning: 'En planificación',
  plan_review: 'Revisión del plan',
  plan_changes_requested: 'Cambios solicitados',
  plan_approved: 'Plan aprobado',
  rejected: 'Rechazado',
  duplicate: 'Duplicado',
  already_implemented: 'Ya implementado',
  implementing: 'Implementando',
  dev_review: 'Revisión de desarrollo',
  sandbox_qa: 'QA en sandbox',
  qa_changes_requested: 'Cambios de QA solicitados',
  staging_qa: 'QA en staging',
  done: 'Completado',
};

export const riskTierLabels: Record<RiskTier, string> = {
  low: 'bajo',
  medium: 'medio',
  high: 'alto',
};

export const ticketCategoryLabels: Record<TicketCategory, string> = {
  bug: 'Error',
  feature: 'Función',
  chore: 'Tarea',
  question: 'Pregunta',
};

export const roleLabels: Record<Role, string> = {
  requester: 'Solicitante',
  dev: 'Desarrollador',
  lead: 'Líder',
  qa: 'QA',
  admin: 'Administrador',
};

export const ticketFlagLabels: Record<TicketFlag, string> = {
  blocked: 'Bloqueado',
  needs_info: 'Necesita información',
  paused: 'Pausado',
  stale_plan: 'Plan desactualizado',
};

export const ticketPriorityLabels: Record<TicketPriority, string> = {
  low: 'baja',
  normal: 'normal',
  high: 'alta',
  immediate: 'inmediata',
};

export const actorKindLabels: Record<ActorKind, string> = {
  ai: 'IA',
  system: 'Sistema',
  qa: 'QA',
  dev: 'Persona',
};

export const runStatusLabels: Record<RunStatus, string> = {
  running: 'En ejecución',
  succeeded: 'Exitosa',
  failed: 'Fallida',
  budget_exhausted: 'Presupuesto agotado',
};

export const runFailureReasonLabels: Record<RunFailureReason, string> = {
  budget_exhausted: 'presupuesto agotado',
  invalid_output: 'salida inválida',
  provider_error: 'error del proveedor',
  cancelled: 'cancelada',
};

export const runKindLabels: Record<RunKind, string> = {
  triage: 'Triaje',
  planning: 'Planificación',
};

export const sourceKindLabels: Record<'openproject' | 'manual', string> = {
  openproject: 'OpenProject',
  manual: 'Manual',
};

export const departmentLabels: Record<Department, string> = {
  support: 'Soporte',
  operations: 'Operaciones',
  finance: 'Finanzas',
  other: 'Otra',
};

export const frequencyLabels: Record<Frequency, string> = {
  daily: 'Diaria',
  weekly: 'Semanal',
  monthly: 'Mensual',
  occasional: 'Ocasional',
};

export const effortLabels: Record<Effort, string> = {
  S: 'Pequeño',
  M: 'Mediano',
  L: 'Grande',
  XL: 'Extra grande',
};

/** Keyed by the numeric `Confidence` value (0.5 / 0.8 / 1) as a string, since object keys are always strings. */
export const confidenceLabels: Record<string, string> = {
  '0.5': '50%',
  '0.8': '80%',
  '1': '100%',
};

export function confidenceLabel(c: Confidence): string {
  return confidenceLabels[String(c)] ?? String(c);
}

export const feasibilityLabels: Record<'feasible' | 'uncertain' | 'infeasible', string> = {
  feasible: 'Factible',
  uncertain: 'Incierta',
  infeasible: 'No factible',
};

export const recommendationLabels: Record<'approve' | 'reject' | 'needs_info', string> = {
  approve: 'Aprobar',
  reject: 'Rechazar',
  needs_info: 'Necesita más información',
};
