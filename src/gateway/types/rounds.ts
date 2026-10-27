export interface RoundsStatus {
  /** Días hacia atrás que cubren los totales (los del resumen de soporte). */
  windowDays: number;
  open: number;
  completed: number;
  incomplete: number;
}

export interface SupportSummary {
  rounds: {
    windowDays: number;
    inProgress: number;
    completed: number;
    incomplete: number;
    expired: number;
  };
  patrollers: {
    total: number;
    active: number;
    inactive: number;
    alert: number;
  };
  checkpoints: {
    total: number;
  };
  suspiciousScans: {
    windowDays: number;
    flagged: number;
  };
}

export interface RoundRef {
  id: string;
  status: string;
  patrollerName: string | null;
  completedCheckpoints: number;
  totalCheckpoints: number;
  startTime: string;
  endTime: string | null;
}

export interface RoundDetail {
  status: string;
  scannedCount: number;
  totalCount: number;
  checkpoints: RoundCheckpointDetail[];
}

export interface RouteRoundsSummary {
  routeName: string;
  isActive: boolean;
  /** Presente si las rondas de ESTA ruta no se pudieron leer: `rounds: []` no significa "no tiene rondas". */
  error?: string;
  rounds: {
    status: string;
    patrollerName: string | null;
    completedCheckpoints: number;
    totalCheckpoints: number;
    startTime: string;
    endTime: string | null;
  }[];
}

export interface RoundCheckpointDetail {
  /** null si el backend no da el nombre (así lo declara el OpenAPI). */
  checkpointName: string | null;
  order: number;
  scanned: boolean;
  scanTime: string | null;
}

export type RoundCheckpointsResult =
  | {
      found: true;
      routeName: string;
      status: string;
      scannedCount: number;
      totalCount: number;
      checkpoints: RoundCheckpointDetail[];
    }
  | { found: false; reason: 'route_not_found'; opciones: string[] }
  // El nombre de ruta casaba con varias: se devuelven para que el usuario elija.
  | { found: false; reason: 'route_ambiguous'; opciones: string[] }
  // No se indicó ruta y hay varias → devolvemos las opciones para que el bot las liste.
  | { found: false; reason: 'route_not_specified'; opciones: string[] }
  | { found: false; reason: 'no_rounds' };
