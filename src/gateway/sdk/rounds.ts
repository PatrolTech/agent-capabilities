import {
  getOrganizationSupportSummary,
  getGetOrganizationSupportSummaryUrl,
  getGetRouteRoundCheckpointsUrl,
  getGetRouteRoundsUrl,
  getRouteRoundCheckpoints,
  getRouteRounds as sdkGetRouteRounds,
  type GetRouteRoundsParams,
  type Route,
  type RouteRoundsPage,
} from '@patroltech/sdk-api';
import { resolveByName } from '../../domain/resolve-by-name.js';
import type {
  ListaTruncable,
  RoundCheckpointsResult,
  RoundDetail,
  RoundRef,
  RoundsStatus,
  RouteRoundsSummary,
  SupportSummary,
} from '../types/index.js';
import { isTruncated } from './list.js';
import { fetchRoutes, ROUTE_LIST_LIMIT } from './routes.js';
import type { SdkTransport } from './transport.js';

const DEFAULT_WINDOW_DAYS = 7;
// Rutas pedidas al backend al componer el detalle de rondas.
const ROUTES_DETAIL_REQUEST_LIMIT = 20;
// Cap de rutas para las que se piden rondas: evita disparar demasiadas peticiones
// en paralelo al backend cuando la organización tiene muchas rutas.
const MAX_ROUTES_FOR_ROUNDS_DETAIL = 8;
// Cap de opciones devueltas cuando no se reconoce el nombre de una ruta.
const MAX_ROUTE_OPTIONS = 15;

/**
 * Una ronda de `GET /api/routes/:id/rounds`. El OpenAPI la declara como objeto
 * libre (`RouteRound = { [key: string]: unknown }`): este es el único tipo de
 * respuesta escrito a mano (README, «Untyped responses»).
 */
interface RouteRoundItem {
  id: string;
  patrollerName: string | null;
  startTime: string;
  endTime: string | null;
  status: 'in_progress' | 'completed' | 'incomplete' | 'expired';
  completedCheckpoints: number;
  totalCheckpoints: number;
  redacted?: boolean;
}

type RouteRoundsPageOf = Omit<RouteRoundsPage, 'results'> & { results: RouteRoundItem[] };

async function fetchRouteRounds(
  t: SdkTransport,
  routeId: string,
  token: string,
  params: GetRouteRoundsParams
): Promise<RouteRoundsPageOf> {
  const id = routeId;
  const page = await t.data(token, getGetRouteRoundsUrl(id, params), (init) =>
    sdkGetRouteRounds(id, params, init)
  );
  // `results` llega sin tipo en el SDK (ver `RouteRoundItem`).
  return { ...page, results: page.results as unknown as RouteRoundItem[] };
}

export async function getSupportSummary(
  t: SdkTransport,
  accountId: string,
  token: string,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<SupportSummary> {
  const id = accountId;
  const params = { windowDays: windowDays || DEFAULT_WINDOW_DAYS };
  return t.data(token, getGetOrganizationSupportSummaryUrl(id, params), (init) =>
    getOrganizationSupportSummary(id, params, init)
  );
}

export async function getRoundsStatus(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<RoundsStatus> {
  const summary = await getSupportSummary(t, accountId, token);
  return {
    windowDays: summary.rounds.windowDays,
    open: summary.rounds.inProgress,
    completed: summary.rounds.completed,
    incomplete: summary.rounds.incomplete + summary.rounds.expired,
  };
}

export async function getRoundsDetail(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<ListaTruncable<RouteRoundsSummary>> {
  const routesBody = await fetchRoutes(t, accountId, token, ROUTES_DETAIL_REQUEST_LIMIT);
  const routes = routesBody.results.slice(0, MAX_ROUTES_FOR_ROUNDS_DETAIL);

  const items = await Promise.all(
    routes.map(async (route): Promise<RouteRoundsSummary> => {
      let rawRounds: RouteRoundItem[] = [];
      let error: string | undefined;
      try {
        rawRounds = (await fetchRouteRounds(t, route.id, token, { limit: 3 })).results;
      } catch (err) {
        // Una ruta cuya consulta de rondas falla no debe tumbar el resto, pero
        // tampoco puede parecer "sin rondas": se marca el error.
        rawRounds = [];
        error = `no se pudieron leer las rondas de esta ruta: ${err instanceof Error ? err.message : String(err)}`;
      }
      return {
        routeName: route.name,
        isActive: route.isActive,
        ...(error ? { error } : {}),
        rounds: rawRounds.map((r) => ({
          status: r.status,
          patrollerName: r.patrollerName ?? null,
          completedCheckpoints: r.completedCheckpoints,
          totalCheckpoints: r.totalCheckpoints,
          startTime: r.startTime,
          endTime: r.endTime ?? null,
        })),
      };
    })
  );
  return { items, total: routesBody.count, truncado: isTruncated(routesBody, items.length) };
}

/** La ruta indicada por nombre, o la única (preferentemente activa) si no se indica; si no, por qué no. */
function pickRoute(
  routes: Route[],
  routeName?: string
): Route | Extract<RoundCheckpointsResult, { found: false }> {
  if (routeName?.trim()) {
    const resolution = resolveByName(routeName, routes, (r) => r.name);
    if (resolution.kind === 'ambiguous') {
      return {
        found: false,
        reason: 'route_ambiguous',
        opciones: resolution.matches.slice(0, MAX_ROUTE_OPTIONS).map((r) => r.name),
      };
    }
    if (resolution.kind === 'none') {
      return {
        found: false,
        reason: 'route_not_found',
        opciones: routes.slice(0, MAX_ROUTE_OPTIONS).map((r) => r.name),
      };
    }
    return resolution.item;
  }
  // Sin ruta indicada: si hay UNA sola (preferentemente activa), se toma por
  // defecto; si hay varias, se devuelven las opciones para que se listen.
  const active = routes.filter((r) => r.isActive);
  const candidates = active.length > 0 ? active : routes;
  if (candidates.length === 1) return candidates[0];
  return {
    found: false,
    reason: 'route_not_specified',
    opciones: candidates.slice(0, MAX_ROUTE_OPTIONS).map((r) => r.name),
  };
}

export async function getRoundCheckpoints(
  t: SdkTransport,
  accountId: string,
  token: string,
  routeName?: string
): Promise<RoundCheckpointsResult> {
  const routesBody = await fetchRoutes(t, accountId, token, ROUTE_LIST_LIMIT);
  const match = pickRoute(routesBody.results, routeName);
  if ('found' in match) return match;

  const rounds = await fetchRouteRounds(t, match.id, token, { limit: 1 });
  const latestRound: RouteRoundItem | undefined = rounds.results[0];
  if (!latestRound) {
    return { found: false, reason: 'no_rounds' };
  }

  return {
    found: true,
    routeName: match.name,
    ...(await getRoundDetail(t, match.id, latestRound.id, token)),
  };
}

export async function getRoundDetail(
  t: SdkTransport,
  routeId: string,
  roundId: string,
  token: string
): Promise<RoundDetail> {
  const [route, round] = [routeId, roundId];
  const body = await t.data(token, getGetRouteRoundCheckpointsUrl(route, round), (init) =>
    getRouteRoundCheckpoints(route, round, init)
  );
  return {
    status: body.status,
    scannedCount: body.scannedCount,
    totalCount: body.totalCount,
    checkpoints: body.checkpoints.map((c) => ({
      checkpointName: c.checkpointName,
      order: c.order,
      scanned: c.scanned,
      scanTime: c.scanTime ?? null,
    })),
  };
}

export async function getRouteRounds(
  t: SdkTransport,
  routeId: string,
  token: string,
  { page, limit }: { page: number; limit: number }
): Promise<{ items: RoundRef[]; totalPages: number }> {
  const body = await fetchRouteRounds(t, routeId, token, { page, limit });
  return {
    totalPages: body.totalPages,
    items: body.results.map((r) => ({
      id: r.id,
      status: r.status,
      patrollerName: r.patrollerName ?? null,
      completedCheckpoints: r.completedCheckpoints,
      totalCheckpoints: r.totalCheckpoints,
      startTime: r.startTime,
      endTime: r.endTime ?? null,
    })),
  };
}
