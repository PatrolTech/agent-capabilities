export interface RouteRef {
  id: string;
  name: string;
  isActive: boolean;
  /** Ubicación de la ruta; ausente o null si no se conoce. */
  locationId?: string | null;
}

/** Horario de una ruta tal como lo guarda el backend: horas `HH:MM` y días ISO (1=lun..7=dom), en UTC. */
export interface RouteTimeWindow {
  id: string;
  startTime: string;
  endTime: string;
  days: number[];
}

/** `GET /api/routes/:id/details`: la ruta con sus checkpoints (en orden) y sus horarios. */
export interface RouteDetails {
  id: string;
  name: string;
  isActive: boolean;
  locationId: string;
  checkpoints: { checkpointId: string; order: number }[];
  timeWindows: RouteTimeWindow[];
}

/** Horario a enviar al backend: horas UTC y la zona en la que se configuró (para que lo reproyecte al cambiar la hora). */
export interface NewTimeWindow {
  startTime: string;
  endTime: string;
  days: number[];
  timezone: string;
}

/** `POST /api/routes/complete`. El `id` lo pone el bot: así un alta dudosa se comprueba por él. */
export interface NewRoute {
  id: string;
  name: string;
  organizationId: string;
  locationId: string;
  requiresOrderedScan: boolean;
  checkpoints: { checkpointId: string; order: number }[];
  timeWindows: NewTimeWindow[];
  scheduleTimezone: string;
}
