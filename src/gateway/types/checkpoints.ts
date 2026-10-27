import type { ListaTruncable } from './common.js';

/**
 * Checkpoint con lo necesario para filtrar y reenviar su QR. `codigo` solo
 * viene si el usuario es EDITOR de esa ubicación: a un VIEWER el backend se lo
 * oculta (`[redacted]`), y entonces es null.
 */
export interface CheckpointRef {
  id: string;
  name: string;
  locationId: string;
  locationName: string;
  /** Tipo del método de verificación (`qr_static`, `manual_code`, `nfc_sun`…); null si no tiene. */
  metodo: string | null;
  codigo: string | null;
  /** Primer escaneo del checkpoint (ISO); null = nunca escaneado. Ausente si el backend no lo informa. */
  primerEscaneo?: string | null;
  /** Código de 8 caracteres de la columna «Identificador» del panel; ausente si el backend no lo informa. */
  identificador?: string;
}

export interface CheckpointRefsResult extends ListaTruncable<CheckpointRef> {
  ubicacionesConError: number;
}

/** Reglas antifraude de un checkpoint (`fraudRules`, backend `fraud-detection/domain/FraudTypes.ts`). Sin una regla = desactivada. */
export interface CheckpointFraudRules {
  gpsProximity?: { maxDistanceMeters: number; maxAccuracyMeters?: number };
  undergroundMode?: { enabled: boolean };
}

/** Posición y reglas antifraude de un checkpoint, para leerlas antes de cambiarlas. */
export interface CheckpointDetail {
  id: string;
  name: string;
  locationId: string;
  metodo: string | null;
  latitud: number | null;
  longitud: number | null;
  reglasAntifraude: CheckpointFraudRules;
  /** Reglas guardadas que el bot no conoce: si hay alguna, no se reescriben desde el bot. */
  reglasDesconocidas: string[];
}

/** Punto de control configurado en la organización, con su ubicación. */
export interface CheckpointInfo {
  /** El que piden las herramientas que actúan sobre checkpoints concretos (p. ej. la hoja de QR). */
  id: string;
  name: string;
  locationName: string | null;
  identificador?: string;
}

/** Checkpoints de la organización, con las ubicaciones que no se pudieron leer. */
export interface CheckpointsResult extends ListaTruncable<CheckpointInfo> {
  /** Nº de ubicaciones cuya consulta falló: sus checkpoints NO están en la lista. */
  ubicacionesConError: number;
}

/** Método de verificación con el que se crea un checkpoint desde el bot (el código lo genera el servidor). */
export type CheckpointMethod = 'qr_static' | 'manual_code';

/** Checkpoint tal como lo devuelve el alta (o la búsqueda que la recupera tras un fallo). */
export interface CreatedCheckpoint {
  id: string;
  name: string;
  locationId: string;
  metodo: string | null;
  /** El código que va en el QR o que se teclea; null si el backend no lo muestra. */
  codigo: string | null;
  /** ISO; null si el backend no lo informa. */
  creadoEn: string | null;
}

/**
 * Ruta de la que se quitó un checkpoint al archivarlo (`affectedRoutes` de
 * `POST /api/checkpoints/:id/archive`): el backend desactiva la que se queda
 * sin checkpoints.
 */
export interface ArchivedCheckpointRoute {
  id: string;
  name: string;
  /** No le queda ningún checkpoint. */
  leftEmpty: boolean;
  /** Estaba activa y el archivado la ha desactivado por quedarse vacía. */
  deactivated: boolean;
}
