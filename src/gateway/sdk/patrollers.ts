import {
  createPatroller as sdkCreatePatroller,
  getCreatePatrollerUrl,
  getGetPatrollerByIdentifierUrl,
  getGetPatrollerRankingUrl,
  getGetPatrollerStatsUrl,
  getListPatrollersUrl,
  getPatrollerByIdentifier as sdkGetPatrollerByIdentifier,
  getPatrollerRanking as sdkGetPatrollerRanking,
  getPatrollerStats as sdkGetPatrollerStats,
  getUpdatePatrollerUrl,
  listPatrollers as sdkListPatrollers,
  updatePatroller as sdkUpdatePatroller,
  type GetPatrollerRankingParams,
  type ListPatrollersResponse,
  type ListPatrollersResponseResultsItem,
  type PatrollerResponse,
} from '@patroltech/sdk-api';
import { resolveByName } from '../../domain/resolve-by-name.js';
import type {
  CreatedPatroller,
  ListaTruncable,
  PatrollerActivity,
  PatrollerRanking,
  PatrollerRef,
  PatrollerStatsResult,
} from '../types/index.js';
import { isNotFound } from './errors.js';
import { isTruncated } from './list.js';
import type { SdkTransport } from './transport.js';

// Límite de vigilantes pedidos al listar o resolver por nombre.
const PATROLLER_LIST_LIMIT = 100;
// Cap de opciones devueltas cuando no se reconoce el nombre de un vigilante.
const MAX_PATROLLER_OPTIONS = 15;
// Cap de entradas del ranking de vigilantes devueltas.
const MAX_RANKING_ENTRIES = 15;
// Cap de checkpoints más escaneados devueltos.
const MAX_TOP_CHECKPOINTS = 10;

function toCreatedPatroller(
  p: PatrollerResponse | ListPatrollersResponseResultsItem
): CreatedPatroller {
  return { id: p.id, name: p.name, identifier: p.identifier, organizationId: p.organizationId };
}

function fetchPatrollers(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<ListPatrollersResponse> {
  const params = { organizationId: accountId, limit: PATROLLER_LIST_LIMIT };
  return t.data(token, getListPatrollersUrl(params), (init) => sdkListPatrollers(params, init));
}

export async function getPatrollerActivity(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<ListaTruncable<PatrollerActivity>> {
  const body = await fetchPatrollers(t, accountId, token);
  const items = body.results.map((p) => ({
    name: p.name,
    lastScanAt: p.lastScanDate ?? null,
    status: p.status,
  }));
  return { items, total: body.count, truncado: isTruncated(body, items.length) };
}

export async function listPatrollers(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<ListaTruncable<PatrollerRef>> {
  const body = await fetchPatrollers(t, accountId, token);
  const items = body.results.map((p) => ({
    id: p.id,
    name: p.name,
    identifier: p.identifier,
    lastScanAt: p.lastScanDate ?? null,
  }));
  return { items, total: body.count, truncado: isTruncated(body, items.length) };
}

export async function getPatrollerStats(
  t: SdkTransport,
  accountId: string,
  token: string,
  patrollerName: string
): Promise<PatrollerStatsResult> {
  const listBody = await fetchPatrollers(t, accountId, token);
  const resolution = resolveByName(patrollerName, listBody.results, (p) => p.name);
  if (resolution.kind === 'ambiguous') {
    // Dos "Juan" no se resuelven cogiendo el primero: se pregunta.
    return {
      found: false,
      ambigua: true,
      opciones: resolution.matches.slice(0, MAX_PATROLLER_OPTIONS).map((p) => p.name),
    };
  }
  if (resolution.kind === 'none') {
    return {
      found: false,
      opciones: listBody.results.slice(0, MAX_PATROLLER_OPTIONS).map((p) => p.name),
    };
  }
  const match = resolution.item;

  const id = match.id;
  const stats = await t.data(token, getGetPatrollerStatsUrl(id), (init) =>
    sdkGetPatrollerStats(id, undefined, init)
  );
  return {
    found: true,
    name: match.name,
    totalScans: stats.totalScans,
    roundsCompleted: stats.roundsCompleted,
    totalRounds: stats.totalRounds,
    completionRate: stats.completionRate,
    avgTimeBetweenScans: stats.avgTimeBetweenScans,
    ...(stats.incidentsReported !== undefined
      ? { incidentsReported: stats.incidentsReported }
      : {}),
    ...(stats.incidentsOpen !== undefined ? { incidentsOpen: stats.incidentsOpen } : {}),
    ...(stats.retentionCutoff !== undefined ? { retentionCutoff: stats.retentionCutoff } : {}),
  };
}

/**
 * Ranking de vigilantes de la organización (ya viene ordenado de mejor a peor por
 * el backend), con el resumen del equipo y los checkpoints más escaneados.
 */
export async function getPatrollerRanking(
  t: SdkTransport,
  accountId: string,
  token: string,
  opts?: { dateFrom?: string; dateTo?: string }
): Promise<PatrollerRanking> {
  const params: GetPatrollerRankingParams = {
    organizationId: accountId,
    ...(opts?.dateFrom ? { from: opts.dateFrom } : {}),
    ...(opts?.dateTo ? { to: opts.dateTo } : {}),
  };
  const body = await t.data(token, getGetPatrollerRankingUrl(params), (init) =>
    sdkGetPatrollerRanking(params, init)
  );
  const truncado =
    body.ranking.length > MAX_RANKING_ENTRIES || body.topCheckpoints.length > MAX_TOP_CHECKPOINTS;
  return {
    truncado,
    summary: body.summary,
    ranking: body.ranking.slice(0, MAX_RANKING_ENTRIES).map((r) => ({
      patrollerName: r.patrollerName,
      totalScans: r.totalScans,
      roundsCompleted: r.roundsCompleted,
      completionRate: r.completionRate,
      avgTimeBetweenScans: r.avgTimeBetweenScans,
    })),
    topCheckpoints: body.topCheckpoints.slice(0, MAX_TOP_CHECKPOINTS),
    ...(body.retentionCutoff !== undefined ? { retentionCutoff: body.retentionCutoff } : {}),
  };
}

export async function createPatroller(
  t: SdkTransport,
  input: { organizationId: string; name: string; identifier: string; phone?: string },
  token: string
): Promise<CreatedPatroller> {
  const body = {
    name: input.name,
    organizationId: input.organizationId,
    identifier: input.identifier,
    ...(input.phone ? { phone: input.phone } : {}),
  };
  const created = await t.data(token, getCreatePatrollerUrl(), (init) =>
    sdkCreatePatroller(body, init)
  );
  return toCreatedPatroller(created);
}

export async function getPatrollerByIdentifier(
  t: SdkTransport,
  identifier: string,
  token: string
): Promise<CreatedPatroller | null> {
  const id = identifier;
  try {
    const p = await t.data(token, getGetPatrollerByIdentifierUrl(id), (init) =>
      sdkGetPatrollerByIdentifier(id, init)
    );
    return toCreatedPatroller(p);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function updatePatroller(
  t: SdkTransport,
  input: { id: string; name?: string; phone?: string },
  token: string
): Promise<CreatedPatroller> {
  // Solo los campos que cambian: el backend ignora los ausentes (no los borra).
  const id = input.id;
  const body = {
    ...(input.name ? { name: input.name } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
  };
  const updated = await t.data(token, getUpdatePatrollerUrl(id), (init) =>
    sdkUpdatePatroller(id, body, init)
  );
  return toCreatedPatroller(updated);
}
