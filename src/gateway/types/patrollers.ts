export interface PatrollerActivity {
  name: string;
  lastScanAt: string | null;
  status: 'active' | 'inactive' | 'alert';
}

export interface PatrollerRef {
  id: string;
  name: string;
  /** Identificador corto (8 hex) con el que el enlace de la app preselecciona al vigilante. */
  identifier: string;
  lastScanAt: string | null;
}

export type PatrollerStatsResult =
  | {
      found: true;
      name: string;
      totalScans: number;
      roundsCompleted: number;
      totalRounds: number;
      completionRate: number;
      avgTimeBetweenScans: number | null;
      incidentsReported?: number;
      incidentsOpen?: number;
      /** Antes de esta fecha (UTC) la retención de datos ya no deja ver el detalle; `null`, ilimitada. */
      retentionCutoff?: string | null;
    }
  | {
      found: false;
      opciones: string[];
      /** El nombre casaba con varios vigilantes: hay que elegir. */ ambigua?: boolean;
    };

/** Entrada del ranking de vigilantes de la organización (ya viene ordenado de mejor a peor). */
export interface PatrollerRankingEntry {
  patrollerName: string;
  totalScans: number;
  roundsCompleted: number;
  completionRate: number;
  avgTimeBetweenScans: number | null;
}

/** Ranking de vigilantes de la organización, con resumen del equipo y checkpoints más escaneados. */
export interface PatrollerRanking {
  summary: {
    totalScans: number;
    activePatrollers: number;
    avgScansPerPatroller: number;
    bestCompletionRate: number;
  };
  ranking: PatrollerRankingEntry[];
  topCheckpoints: { checkpointName: string; totalScans: number }[];
  /** true si el ranking o los checkpoints top se han recortado. */
  truncado: boolean;
  /** El periodo nunca empieza antes de esta fecha (UTC), por la retención de datos; `null`, ilimitada. */
  retentionCutoff?: string | null;
}

/** Vigilante tal como lo devuelve el alta o `GET /api/patrollers/identifier/:identifier`. */
export interface CreatedPatroller {
  id: string;
  name: string;
  identifier: string;
  organizationId: string;
}

/** Tipos de alerta que el usuario puede configurar (`userConfigurable` en el AlertTypeRegistry del backend). */
export const ALERT_TYPES = [
  'pending_route',
  'missed_route',
  'upcoming_deadline',
  'patroller_inactive',
  'suspicious_scan',
  'role_assignment',
  'incident_created',
  'incident_status_changed',
  'incident_assigned',
  'incident_comment',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_CHANNELS = ['email', 'push', 'whatsapp'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
