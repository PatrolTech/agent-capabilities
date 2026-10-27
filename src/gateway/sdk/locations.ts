import {
  deleteLocation as sdkDeleteLocation,
  getDeleteLocationUrl,
  getListLocationsUrl,
  getUpdateLocationUrl,
  listLocations as sdkListLocations,
  updateLocation as sdkUpdateLocation,
  type ListLocationsResponse,
} from '@patroltech/sdk-api';
import type { LocationRef } from '../types/index.js';
import type { SdkTransport } from './transport.js';

/** Nombre que se muestra para una ubicación que en el backend no tiene nombre. */
export const UBICACION_SIN_NOMBRE = 'Ubicación principal';

/** Ubicación con su nombre ya resuelto (nunca null). */
export interface NamedLocation {
  id: string;
  name: string;
  address: string | null;
}

/**
 * `/api/locations` NO pagina: su `data` es un array plano (así lo declara el OpenAPI). Se acepta también la forma paginada por
 * si el backend la adopta. `name` es null en organizaciones con una sola ubicación
 * creada sin nombre.
 */
export async function fetchLocations(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<NamedLocation[]> {
  const params = { organizationId: accountId };
  const list = locationList(
    await t.data(token, getListLocationsUrl(params), (init) => sdkListLocations(params, init))
  );
  // Las organizaciones con una sola ubicación la tienen SIN nombre (`name: null`):
  // sin esto el resumen decía «ubicación «null»» y la acción fallaba al ejecutarse.
  return list.map((l) => ({
    id: l.id,
    name: l.name?.trim() || UBICACION_SIN_NOMBRE,
    address: l.address?.trim() || null,
  }));
}

/** El array de ubicaciones, venga plano (lo de hoy) o paginado. */
function locationList(
  body: ListLocationsResponse | { results?: ListLocationsResponse }
): ListLocationsResponse {
  return Array.isArray(body) ? body : (body.results ?? []);
}

export async function listLocations(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<LocationRef[]> {
  return (await fetchLocations(t, accountId, token)).map((l) => ({
    id: l.id,
    name: l.name,
    address: l.address,
  }));
}

export async function updateLocation(
  t: SdkTransport,
  input: { id: string; name?: string; address?: string },
  token: string
): Promise<void> {
  // El backend asigna el body tal cual (sin filtrar): SOLO estos dos campos, y la dirección nunca vacía (no admite null).
  const id = input.id;
  const body = {
    ...(input.name ? { name: input.name } : {}),
    ...(input.address ? { address: input.address } : {}),
  };
  await t.envelope(token, getUpdateLocationUrl(id), (init) => sdkUpdateLocation(id, body, init));
}

export async function deleteLocation(t: SdkTransport, id: string, token: string): Promise<void> {
  const locationId = id;
  await t.envelope(token, getDeleteLocationUrl(locationId), (init) =>
    sdkDeleteLocation(locationId, init)
  );
}
