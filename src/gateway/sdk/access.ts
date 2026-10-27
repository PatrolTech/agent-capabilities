import {
  getActiveEntries,
  getGetActiveEntriesUrl,
  getListAccessLogsUrl,
  listAccessLogs as sdkListAccessLogs,
  type AccessLogsListResponseResultsItem,
  type ActiveEntriesResponseItem,
  type GetActiveEntriesParams,
  type ListAccessLogsParams,
} from '@patroltech/sdk-api';
import type { AccessLogEntry, AccessLogQuery } from '../types/index.js';
import type { SdkTransport } from './transport.js';

// `accessHistoryQuerySchema` del backend: `limit` máximo 100.
const ACCESS_LOG_PAGE = 100;

/** AccessLogDTO del backend: el historial y las entradas activas traen la misma forma. */
type AccessLogItem = AccessLogsListResponseResultsItem | ActiveEntriesResponseItem;

function toAccessLogEntry(a: AccessLogItem): AccessLogEntry {
  return {
    id: a.id,
    locationId: a.locationId,
    zona: a.zone ?? null,
    tipo: a.type,
    fecha: a.timestamp,
    persona: a.authorizedPersonName ?? null,
    identificadorPersona: a.authorizedPersonIdentifier ?? null,
    visitante: a.visitorName ?? null,
    documentoVisitante: a.visitorDocument ?? null,
    empresaVisitante: a.visitorCompany ?? null,
    destino: a.destination ?? null,
    notas: a.notes ?? null,
    oculto: a.redacted === true,
  };
}

export async function listAccessLogs(
  t: SdkTransport,
  query: AccessLogQuery,
  token: string
): Promise<{ items: AccessLogEntry[]; total: number }> {
  const params: ListAccessLogsParams = {
    locationId: query.locationId,
    page: query.page ?? 1,
    limit: Math.min(query.limit ?? ACCESS_LOG_PAGE, ACCESS_LOG_PAGE),
    ...(query.zona ? { zone: query.zona } : {}),
    ...(query.tipo ? { type: query.tipo } : {}),
    ...(query.desde ? { from: query.desde } : {}),
    ...(query.hasta ? { to: query.hasta } : {}),
  };
  const body = await t.data(token, getListAccessLogsUrl(params), (init) =>
    sdkListAccessLogs(params, init)
  );
  return { items: body.results.map(toAccessLogEntry), total: body.total };
}

export async function listActiveAccessEntries(
  t: SdkTransport,
  locationId: string,
  token: string,
  zona?: string
): Promise<AccessLogEntry[]> {
  const params: GetActiveEntriesParams = { locationId, ...(zona ? { zone: zona } : {}) };
  const body = await t.data(token, getGetActiveEntriesUrl(params), (init) =>
    getActiveEntries(params, init)
  );
  return body.map(toAccessLogEntry);
}
