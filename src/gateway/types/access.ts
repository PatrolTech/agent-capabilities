export type AccessType = 'ENTRY' | 'EXIT';

/** Filtros de `GET …/access-logs`; `desde`/`hasta` en ISO UTC. El backend exige la ubicación. */
export interface AccessLogQuery {
  locationId: string;
  zona?: string;
  tipo?: AccessType;
  desde?: string;
  hasta?: string;
  /** 1-based. */
  page?: number;
  /** Máximo 100 (el backend rechaza más). */
  limit?: number;
}

/** Un registro del Control de Acceso. `oculto` = la retención del plan ha borrado sus datos personales. */
export interface AccessLogEntry {
  id: string;
  locationId: string;
  zona: string | null;
  tipo: AccessType;
  fecha: string;
  /** Persona autorizada (de la lista del panel). */
  persona: string | null;
  identificadorPersona: string | null;
  visitante: string | null;
  /** Documento del visitante: solo va al Excel, nunca al texto del chat. */
  documentoVisitante: string | null;
  empresaVisitante: string | null;
  destino: string | null;
  notas: string | null;
  oculto: boolean;
}
