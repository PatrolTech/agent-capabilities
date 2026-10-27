import {
  addCheckpointToRoute as sdkAddCheckpointToRoute,
  addTimeWindowToRoute,
  createRouteComplete,
  getAddCheckpointToRouteUrl,
  getAddTimeWindowToRouteUrl,
  getCreateRouteCompleteUrl,
  getGetRouteWithDetailsUrl,
  getListRoutesUrl,
  getRemoveCheckpointFromRouteUrl,
  getRemoveTimeWindowFromRouteUrl,
  getRouteWithDetails,
  getToggleRouteActiveUrl,
  listRoutes as sdkListRoutes,
  removeCheckpointFromRoute as sdkRemoveCheckpointFromRoute,
  removeTimeWindowFromRoute,
  toggleRouteActive,
  type PaginatedRoutes,
  type RouteWithDetails,
} from '@patroltech/sdk-api';
import type {
  ListaTruncable,
  NewRoute,
  NewTimeWindow,
  RouteDetails,
  RouteRef,
} from '../types/index.js';
import { isNotFound } from './errors.js';
import { isTruncated } from './list.js';
import type { SdkTransport } from './transport.js';

// Límite de rutas consultadas al listar o resolver una ruta por nombre.
export const ROUTE_LIST_LIMIT = 50;

/** Una página de rutas de la organización. */
export async function fetchRoutes(
  t: SdkTransport,
  accountId: string,
  token: string,
  limit: number
): Promise<PaginatedRoutes> {
  const params = { organizationId: accountId, limit };
  return t.data(token, getListRoutesUrl(params), (init) => sdkListRoutes(params, init));
}

export async function listRoutes(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<ListaTruncable<RouteRef>> {
  const body = await fetchRoutes(t, accountId, token, ROUTE_LIST_LIMIT);
  const items = body.results.map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.isActive,
    locationId: typeof r.locationId === 'string' ? r.locationId : null,
  }));
  return { items, total: body.count, truncado: isTruncated(body, items.length) };
}

export async function getRouteDetails(
  t: SdkTransport,
  routeId: string,
  token: string
): Promise<RouteDetails | null> {
  const id = routeId;
  let r: RouteWithDetails;
  try {
    r = await t.data(token, getGetRouteWithDetailsUrl(id), (init) => getRouteWithDetails(id, init));
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  return {
    id: r.id,
    name: r.name,
    isActive: r.isActive,
    locationId: r.locationId,
    checkpoints: (r.checkpoints ?? [])
      .map((c) => ({ checkpointId: c.checkpointId, order: c.order }))
      .sort((a, b) => a.order - b.order),
    // El backend las devuelve `HH:MM:SS`; aquí van `HH:MM` como las que se envían.
    timeWindows: (r.timeWindows ?? []).map((w) => ({
      id: w.id,
      startTime: w.startTime.slice(0, 5),
      endTime: w.endTime.slice(0, 5),
      days: w.days,
    })),
  };
}

export async function createRoute(
  t: SdkTransport,
  input: NewRoute,
  token: string
): Promise<{ id: string; name: string }> {
  // El cuerpo tal cual (id del bot, horarios UTC con su zona).
  const r = await t.data(token, getCreateRouteCompleteUrl(), (init) =>
    createRouteComplete(input, init)
  );
  return { id: r.id, name: r.name };
}

export async function addRouteTimeWindow(
  t: SdkTransport,
  routeId: string,
  window: NewTimeWindow,
  token: string
): Promise<void> {
  const id = routeId;
  await t.envelope(token, getAddTimeWindowToRouteUrl(id), (init) =>
    addTimeWindowToRoute(id, window, init)
  );
}

export async function deleteRouteTimeWindow(
  t: SdkTransport,
  timeWindowId: string,
  token: string
): Promise<void> {
  const id = timeWindowId;
  await t.envelope(token, getRemoveTimeWindowFromRouteUrl(id), (init) =>
    removeTimeWindowFromRoute(id, init)
  );
}

export async function setRouteActive(
  t: SdkTransport,
  routeId: string,
  isActive: boolean,
  token: string
): Promise<void> {
  const id = routeId;
  await t.envelope(token, getToggleRouteActiveUrl(id), (init) =>
    toggleRouteActive(id, { isActive }, init)
  );
}

export async function addCheckpointToRoute(
  t: SdkTransport,
  routeId: string,
  checkpointId: string,
  order: number,
  token: string
): Promise<void> {
  const [route, checkpoint] = [routeId, checkpointId];
  await t.envelope(token, getAddCheckpointToRouteUrl(route, checkpoint), (init) =>
    sdkAddCheckpointToRoute(route, checkpoint, { order }, init)
  );
}

export async function removeCheckpointFromRoute(
  t: SdkTransport,
  routeId: string,
  checkpointId: string,
  token: string
): Promise<void> {
  const [route, checkpoint] = [routeId, checkpointId];
  await t.envelope(token, getRemoveCheckpointFromRouteUrl(route, checkpoint), (init) =>
    sdkRemoveCheckpointFromRoute(route, checkpoint, init)
  );
}
