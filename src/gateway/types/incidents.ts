import type { IncidentStatus } from '../../domain/incident-status.js';

/** Incidencia tal como la lista el backend. `titulo` es null si la oculta la retención del plan. */
export interface IncidentRef {
  id: string;
  titulo: string | null;
  estado: IncidentStatus;
  prioridad: string;
  locationId: string | null;
  asignadoAId: string | null;
  asignadoA: string | null;
  creadaEn: string;
}

/** A qué incidencia va una escritura: el `locationId` da el rol de ubicación y el `organizationId` el gate de la App. */
export interface IncidentTarget {
  incidentId: string;
  organizationId: string;
  locationId: string | null;
}

/** Una entrada del historial de una incidencia (`tipo` es el del backend: CREATED, STATUS_CHANGE, COMMENT…). */
export interface IncidentTimelineEntry {
  tipo: string;
  autor: string | null;
  texto: string | null;
  /** Valor anterior y nuevo en los cambios (estado, prioridad, asignación…). */
  antes: string | null;
  despues: string | null;
  fecha: string;
  /** Lleva una foto o un vídeo enlazado (la URL no se guarda). */
  conAdjunto: boolean;
}

/** Detalle de una incidencia. `oculta` = la retención del plan ya no conserva sus datos. */
export interface IncidentDetail {
  id: string;
  oculta: boolean;
  titulo: string | null;
  descripcion: string | null;
  estado: IncidentStatus;
  prioridad: string;
  categoria: string | null;
  subcategoria: string | null;
  reportadaPor: string | null;
  asignadaA: string | null;
  locationId: string | null;
  creadaEn: string;
  resueltaEn: string | null;
  cerradaEn: string | null;
  /** Nombres de los checkpoints vinculados. */
  checkpoints: string[];
  timeline: IncidentTimelineEntry[];
  fotos: number;
  videos: number;
}
