import type { FixedTextLanguage } from './language.js';

/**
 * Estados y reglas de una incidencia, los mismos que aplica la API, para explicarle al
 * cliente ANTES de proponer por qué un cambio no se puede hacer. El backend
 * sigue siendo quien decide.
 */
export const INCIDENT_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'DISCARDED',
  'CLOSED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Nombres de los estados tal como salen en el panel (i18n `incidentReporting.status`). */
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, Record<FixedTextLanguage, string>> = {
  OPEN: { es: 'Abierto', en: 'Open', fr: 'Ouvert' },
  IN_PROGRESS: { es: 'En progreso', en: 'In Progress', fr: 'En cours' },
  RESOLVED: { es: 'Resuelto', en: 'Resolved', fr: 'Résolu' },
  CLOSED: { es: 'Cerrado', en: 'Closed', fr: 'Clôturé' },
  DISCARDED: { es: 'Descartado', en: 'Discarded', fr: 'Rejeté' },
};

/** Cómo se nombra cada estado en los parámetros de las tools (en español, sin espacios). */
export const INCIDENT_STATUS_PARAM = {
  abierto: 'OPEN',
  en_progreso: 'IN_PROGRESS',
  resuelto: 'RESOLVED',
  cerrado: 'CLOSED',
  descartado: 'DISCARDED',
} as const satisfies Record<string, IncidentStatus>;
export type IncidentStatusParam = keyof typeof INCIDENT_STATUS_PARAM;
export const INCIDENT_STATUS_PARAMS = Object.keys(INCIDENT_STATUS_PARAM) as [
  IncidentStatusParam,
  ...IncidentStatusParam[],
];

/** `ALLOWED_TRANSITIONS` del backend. */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ['IN_PROGRESS', 'DISCARDED'],
  IN_PROGRESS: ['RESOLVED', 'OPEN', 'DISCARDED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  DISCARDED: [],
  CLOSED: [],
};

/** Resolver y descartar exigen comentario (`requiresComment`). */
export const INCIDENT_REQUIRES_COMMENT: readonly IncidentStatus[] = ['RESOLVED', 'DISCARDED'];

/** Pasar a En progreso exige que esté asignada (`requiresAssignment`). */
export const INCIDENT_REQUIRES_ASSIGNMENT: readonly IncidentStatus[] = ['IN_PROGRESS'];

/** Cerrado y Descartado son definitivos: después no se puede cambiar nada (`isIncidentLocked`). */
export const INCIDENT_FINAL: readonly IncidentStatus[] = ['CLOSED', 'DISCARDED'];
