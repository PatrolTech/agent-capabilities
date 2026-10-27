import type { CheckpointResponse, ListCheckpointsResponseResultsItem } from '@patroltech/sdk-api';
import type { CheckpointDetail, CheckpointFraudRules, CreatedCheckpoint } from '../types/index.js';

/**
 * Un checkpoint del backend, de una lista o del alta (tipos generados del SDK).
 * `verificationMethod.config.code` solo viene en claro para un EDITOR de la
 * ubicación; a un VIEWER le llega `[redacted]`.
 */
export type CheckpointItem = (ListCheckpointsResponseResultsItem | CheckpointResponse) & {
  /** Fecha de alta: el backend la envía, el OpenAPI aún no la declara (README, «Untyped responses»). */
  createdAt?: string;
};

/** `fraudRules` tal como puede llegar: el objeto del OpenAPI, o texto JSON si la API lo devuelve sin parsear. */
export type RawFraudRules = CheckpointItem['fraudRules'] | string;

/** Lo que el backend pone en `code`/`uid` cuando quien pregunta no puede verlos. */
const REDACTED = '[redacted]';

/** El código del método si viene en claro; null si falta o está oculto. */
export function visibleCode(cp: CheckpointItem): string | null {
  const code = cp.verificationMethod?.config?.code;
  return typeof code === 'string' && code.trim() && code !== REDACTED ? code : null;
}

/**
 * `fraudRules` del backend → las reglas que se conocen y los nombres de las demás.
 * Solo se aceptan con su forma conocida; una regla rara cuenta como desconocida
 * para no borrarla al reescribir el objeto entero.
 */
export function toFraudRules(
  raw: RawFraudRules | undefined
): Pick<CheckpointDetail, 'reglasAntifraude' | 'reglasDesconocidas'> {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
    } catch {
      return { reglasAntifraude: {}, reglasDesconocidas: ['fraudRules'] };
    }
  } else if (raw) {
    obj = raw;
  }
  const reglasAntifraude: CheckpointFraudRules = {};
  const reglasDesconocidas: string[] = [];
  for (const [regla, valor] of Object.entries(obj)) {
    const v = (valor ?? {}) as Record<string, unknown>;
    if (regla === 'gpsProximity' && typeof v.maxDistanceMeters === 'number') {
      reglasAntifraude.gpsProximity = {
        maxDistanceMeters: v.maxDistanceMeters,
        ...(typeof v.maxAccuracyMeters === 'number'
          ? { maxAccuracyMeters: v.maxAccuracyMeters }
          : {}),
      };
    } else if (regla === 'undergroundMode' && typeof v.enabled === 'boolean') {
      reglasAntifraude.undergroundMode = { enabled: v.enabled };
    } else if (valor != null) {
      reglasDesconocidas.push(regla);
    }
  }
  return { reglasAntifraude, reglasDesconocidas };
}

export function toCreatedCheckpoint(cp: CheckpointItem): CreatedCheckpoint {
  return {
    id: cp.id,
    name: cp.name,
    locationId: cp.locationId,
    metodo: cp.verificationMethod?.type ?? null,
    codigo: visibleCode(cp),
    creadoEn: cp.createdAt ?? null,
  };
}
