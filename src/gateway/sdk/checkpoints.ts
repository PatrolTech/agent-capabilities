import {
  archiveCheckpoint as sdkArchiveCheckpoint,
  createCheckpoint as sdkCreateCheckpoint,
  getArchiveCheckpointUrl,
  getCreateCheckpointUrl,
  getListCheckpointsUrl,
  getUnarchiveCheckpointUrl,
  getUpdateCheckpointUrl,
  listCheckpoints as sdkListCheckpoints,
  unarchiveCheckpoint as sdkUnarchiveCheckpoint,
  updateCheckpoint as sdkUpdateCheckpoint,
  type ArchiveCheckpointResponse,
  type ListCheckpointsParams,
  type ListCheckpointsResponse,
  type UpdateCheckpointBody,
} from '@patroltech/sdk-api';
import type {
  ArchivedCheckpointRoute,
  CheckpointDetail,
  CheckpointFraudRules,
  CheckpointInfo,
  CheckpointMethod,
  CheckpointRef,
  CheckpointRefsResult,
  CheckpointsResult,
  CreatedCheckpoint,
} from '../types/index.js';
import {
  toCreatedCheckpoint,
  toFraudRules,
  visibleCode,
  type CheckpointItem,
} from './checkpoint-mappers.js';
import { isTruncated } from './list.js';
import { fetchLocations, type NamedLocation } from './locations.js';
import type { SdkTransport } from './transport.js';

// Cap de ubicaciones para las que se piden checkpoints: evita disparar demasiadas
// peticiones en paralelo al backend cuando la organización tiene muchas ubicaciones.
const MAX_LOCATIONS_FOR_CHECKPOINTS = 20;
// Límite de checkpoints pedidos por ubicación (paginado del backend).
const CHECKPOINTS_PER_LOCATION_LIMIT = 100;

interface CheckpointRows {
  rows: { cp: CheckpointItem; location: NamedLocation }[];
  truncado: boolean;
  ubicacionesConError: number;
}

function fetchLocationCheckpoints(
  t: SdkTransport,
  token: string,
  params: ListCheckpointsParams
): Promise<ListCheckpointsResponse> {
  return t.data(token, getListCheckpointsUrl(params), (init) => sdkListCheckpoints(params, init));
}

/**
 * Checkpoints de TODAS las ubicaciones de la organización (el endpoint de
 * checkpoints va por `locationId`, no por `organizationId`). `archivados` true:
 * SOLO los archivados (`includeArchived=true` trae los dos y se filtra).
 */
async function fetchCheckpoints(
  t: SdkTransport,
  accountId: string,
  token: string,
  archivados = false
): Promise<CheckpointRows> {
  const allLocations = await fetchLocations(t, accountId, token);
  const locations = allLocations.slice(0, MAX_LOCATIONS_FOR_CHECKPOINTS);
  let truncado = allLocations.length > locations.length;
  let ubicacionesConError = 0;

  const perLocation = await Promise.all(
    locations.map(async (location) => {
      try {
        const body = await fetchLocationCheckpoints(t, token, {
          locationId: location.id,
          limit: CHECKPOINTS_PER_LOCATION_LIMIT,
          ...(archivados ? { includeArchived: true } : {}),
        });
        if (isTruncated(body, body.results.length)) truncado = true;
        return body.results
          .filter((c) => (c.archivedAt != null) === archivados)
          .map((cp) => ({ cp, location }));
      } catch (err) {
        // Una ubicación cuya consulta falla no debe tumbar el resto, pero se
        // cuenta: sin eso sus checkpoints simplemente "no existían" y se daban
        // por abandonados.
        t.logger.warn('sdk_client.get_checkpoints_location_failed', {
          locationId: location.id,
          err,
        });
        ubicacionesConError += 1;
        return [];
      }
    })
  );
  return { rows: perLocation.flat(), truncado, ubicacionesConError };
}

/** Enumera TODOS los checkpoints configurados en la organización, con su ubicación. */
export async function getCheckpoints(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<CheckpointsResult> {
  const { rows, truncado, ubicacionesConError } = await fetchCheckpoints(t, accountId, token);
  const seen = new Set<string>();
  const items: CheckpointInfo[] = [];
  for (const { cp, location } of rows) {
    // Separador imposible en un nombre: "A B" en "C" ya no colisiona con "A" en "B C" (M5).
    // Con identificador, dos checkpoints que se llaman igual en la misma ubicación son dos.
    const key = `${cp.name}\u0000${location.name}\u0000${cp.identifier ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: cp.id,
      name: cp.name,
      locationName: location.name,
      ...(cp.identifier ? { identificador: cp.identifier } : {}),
    });
  }
  return { items, truncado, ubicacionesConError };
}

export async function listCheckpoints(
  t: SdkTransport,
  accountId: string,
  token: string,
  archivados = false
): Promise<CheckpointRefsResult> {
  const { rows, truncado, ubicacionesConError } = await fetchCheckpoints(
    t,
    accountId,
    token,
    archivados
  );
  const items = rows.map(({ cp, location }): CheckpointRef => ({
    id: cp.id,
    name: cp.name,
    locationId: location.id,
    locationName: location.name,
    metodo: cp.verificationMethod?.type ?? null,
    codigo: visibleCode(cp),
    ...(cp.firstScanAt !== undefined ? { primerEscaneo: cp.firstScanAt } : {}),
    ...(cp.identifier ? { identificador: cp.identifier } : {}),
  }));
  return { items, truncado, ubicacionesConError };
}

export async function createCheckpoint(
  t: SdkTransport,
  input: { name: string; locationId: string; metodo: CheckpointMethod },
  token: string
): Promise<CreatedCheckpoint> {
  // Payload mínimo del alta del panel: categoría vacía (el backend la admite) y
  // `config` vacío para que el servidor genere el código. Sin `confirmExtraBilling`:
  // si supera el plan, el backend responde 402/409 y no cobra nada.
  const body = {
    name: input.name,
    locationId: input.locationId,
    category: '',
    verificationMethod: { type: input.metodo, config: {} },
  };
  const created = await t.data(token, getCreateCheckpointUrl(), (init) =>
    sdkCreateCheckpoint(body, init)
  );
  return toCreatedCheckpoint(created);
}

/** Checkpoints de la ubicación cuyo nombre contiene `name` (`search` del backend). */
function searchLocationCheckpoints(
  t: SdkTransport,
  locationId: string,
  name: string,
  token: string
): Promise<ListCheckpointsResponse> {
  return fetchLocationCheckpoints(t, token, {
    locationId,
    search: name,
    limit: CHECKPOINTS_PER_LOCATION_LIMIT,
  });
}

export async function findCheckpointsByName(
  t: SdkTransport,
  locationId: string,
  name: string,
  token: string
): Promise<CreatedCheckpoint[]> {
  const body = await searchLocationCheckpoints(t, locationId, name, token);
  return body.results.map(toCreatedCheckpoint);
}

export async function getCheckpointDetail(
  t: SdkTransport,
  input: { id: string; locationId: string; name: string },
  token: string
): Promise<CheckpointDetail | null> {
  // Sin GET por id: la lista de su ubicación, filtrada por su nombre para no depender del límite de 100.
  const body = await searchLocationCheckpoints(t, input.locationId, input.name, token);
  const cp = body.results.find((c) => c.id === input.id);
  if (!cp) return null;
  return {
    id: cp.id,
    name: cp.name,
    locationId: cp.locationId,
    metodo: cp.verificationMethod?.type ?? null,
    latitud: typeof cp.latitude === 'number' ? cp.latitude : null,
    longitud: typeof cp.longitude === 'number' ? cp.longitude : null,
    ...toFraudRules(cp.fraudRules),
  };
}

/** `PUT /api/checkpoints/:id` con SOLO los campos dados. */
async function putCheckpoint(
  t: SdkTransport,
  checkpointId: string,
  body: UpdateCheckpointBody,
  token: string
): Promise<void> {
  const id = checkpointId;
  await t.envelope(token, getUpdateCheckpointUrl(id), (init) =>
    sdkUpdateCheckpoint(id, body, init)
  );
}

export async function updateCheckpoint(
  t: SdkTransport,
  input: { id: string; name?: string; description?: string },
  token: string
): Promise<void> {
  await putCheckpoint(
    t,
    input.id,
    {
      ...(input.name ? { name: input.name } : {}),
      ...(input.description ? { description: input.description } : {}),
    },
    token
  );
}

export async function updateCheckpointFraudRules(
  t: SdkTransport,
  input: { id: string; fraudRules: CheckpointFraudRules | null },
  token: string
): Promise<void> {
  await putCheckpoint(t, input.id, { fraudRules: input.fraudRules }, token);
}

export async function moveCheckpoint(
  t: SdkTransport,
  input: { id: string; latitude: number; longitude: number },
  token: string
): Promise<void> {
  await putCheckpoint(t, input.id, { latitude: input.latitude, longitude: input.longitude }, token);
}

export async function archiveCheckpoint(
  t: SdkTransport,
  checkpointId: string,
  token: string
): Promise<ArchivedCheckpointRoute[] | null> {
  const id = checkpointId;
  // Un backend anterior a `affectedRoutes` (o sin cuerpo) no dice qué rutas tocó: null.
  const body: Partial<ArchiveCheckpointResponse> | null = await t.data(
    token,
    getArchiveCheckpointUrl(id),
    (init) => sdkArchiveCheckpoint(id, init)
  );
  const rutas = body?.affectedRoutes;
  if (!Array.isArray(rutas)) return null;
  // `=== true`: un backend que no mande el booleano cuenta como false.
  return rutas.map((r) => ({
    id: r.id,
    name: r.name,
    leftEmpty: r.leftEmpty === true,
    deactivated: r.deactivated === true,
  }));
}

export async function unarchiveCheckpoint(
  t: SdkTransport,
  checkpointId: string,
  token: string
): Promise<void> {
  // Sin `confirmExtraBilling`: si supera el plan, el backend responde 402/409 y no cobra nada.
  const id = checkpointId;
  await t.envelope(token, getUnarchiveCheckpointUrl(id), (init) =>
    sdkUnarchiveCheckpoint(id, {}, init)
  );
}
