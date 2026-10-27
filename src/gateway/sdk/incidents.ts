import {
  getAddIncidentCommentUrl,
  getAssignIncidentUrl,
  getGetIncidentDetailUrl,
  getListIncidentsUrl,
  getUpdateIncidentStatusUrl,
  listIncidents as sdkListIncidents,
  type IncidentDetailResponse,
  type IncidentDetailResponseMediaItem,
  type ListIncidentsParams,
} from '@patroltech/sdk-api';
import type { IncidentStatus } from '../../domain/incident-status.js';
import type {
  IncidentDetail,
  IncidentRef,
  IncidentTarget,
  ListaTruncable,
} from '../types/index.js';
import { isNotFound } from './errors.js';
import type { SdkTransport } from './transport.js';

// El backend da como mucho 100 incidencias por página; las más recientes bastan para resolver por título.
const INCIDENT_LIST_LIMIT = 100;

/**
 * `GET …/incidents/:id`: el DTO del
 * SDK con su timeline y sus adjuntos. El `type` de cada adjunto (`PHOTO`/`VIDEO`)
 * lo envía el backend pero el OpenAPI no lo declara (README, «Untyped responses»).
 */
type IncidentDetailItem = Omit<IncidentDetailResponse, 'media'> & {
  media?: (IncidentDetailResponseMediaItem & { type?: string })[];
};

/**
 * URL de una incidencia con su ámbito en la query: la API comprueba con él que la
 * App de incidencias está activa y el rol del usuario (sin la ubicación solo vale el
 * rol de organización y un editor de ubicación recibiría 403). Con `locationId` la
 * API deduce la organización de la ubicación.
 *
 * El OpenAPI de estas operaciones aún no declara esa query: la ruta sale del SDK
 * y la query se añade aquí (README, «Pending OpenAPI coverage»).
 */
function incidentUrl(t: IncidentTarget, pathFor: (id: string) => string): string {
  const scope = t.locationId
    ? `locationId=${encodeURIComponent(t.locationId)}`
    : `organizationId=${encodeURIComponent(t.organizationId)}`;
  return `${pathFor(t.incidentId)}?${scope}`;
}

export async function listIncidents(
  t: SdkTransport,
  accountId: string,
  token: string,
  opts?: { estado?: IncidentStatus }
): Promise<ListaTruncable<IncidentRef>> {
  const params: ListIncidentsParams = {
    organizationId: accountId,
    limit: INCIDENT_LIST_LIMIT,
    sortBy: 'createdAt',
    sortOrder: 'DESC',
    ...(opts?.estado ? { status: opts.estado } : {}),
  };
  const body = await t.data(token, getListIncidentsUrl(params), (init) =>
    sdkListIncidents(params, init)
  );
  const items = body.results.map((i): IncidentRef => ({
    id: i.id,
    titulo: i.redacted ? null : i.title,
    estado: i.status,
    prioridad: i.priority,
    locationId: i.locationId ?? null,
    asignadoAId: i.assignedToUserId ?? null,
    asignadoA: i.assignedToName ?? null,
    creadaEn: i.createdAt,
  }));
  return { items, total: body.total, truncado: body.total > items.length };
}

export async function getIncidentDetail(
  t: SdkTransport,
  target: IncidentTarget,
  token: string
): Promise<IncidentDetail | null> {
  let i: IncidentDetailItem;
  try {
    i = await t.uncovered<IncidentDetailItem>(
      token,
      'GET',
      incidentUrl(target, getGetIncidentDetailUrl)
    );
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  const media = i.media ?? [];
  return {
    id: i.id,
    oculta: i.redacted === true,
    titulo: i.title ?? null,
    descripcion: i.description ?? null,
    estado: i.status,
    prioridad: i.priority,
    categoria: i.categoryName ?? null,
    subcategoria: i.subcategoryName ?? null,
    reportadaPor: i.reporterName ?? null,
    asignadaA: i.assignedToName ?? null,
    locationId: i.locationId ?? null,
    creadaEn: i.createdAt,
    resueltaEn: i.resolvedAt ?? null,
    cerradaEn: i.closedAt ?? null,
    checkpoints: (i.checkpoints ?? []).map((c) => c.name),
    // Las URLs de los adjuntos están firmadas: solo se conserva si los hay.
    timeline: (i.timeline ?? []).map((e) => ({
      tipo: e.type,
      autor: e.authorName ?? null,
      texto: e.content ?? null,
      antes: e.oldValue ?? null,
      despues: e.newValue ?? null,
      fecha: e.createdAt,
      conAdjunto: Boolean(e.mediaUrl),
    })),
    fotos: media.filter((m) => m.type === 'PHOTO').length,
    videos: media.filter((m) => m.type === 'VIDEO').length,
  };
}

export async function updateIncidentStatus(
  t: SdkTransport,
  input: IncidentTarget & { estado: IncidentStatus; comentario?: string },
  token: string
): Promise<void> {
  await t.uncovered(token, 'PATCH', incidentUrl(input, getUpdateIncidentStatusUrl), {
    status: input.estado,
    ...(input.comentario ? { comment: input.comentario } : {}),
  });
}

export async function assignIncident(
  t: SdkTransport,
  input: IncidentTarget & { userId: string },
  token: string
): Promise<void> {
  await t.uncovered(token, 'PATCH', incidentUrl(input, getAssignIncidentUrl), {
    assignToUserId: input.userId,
  });
}

export async function commentIncident(
  t: SdkTransport,
  input: IncidentTarget & { comentario: string },
  token: string
): Promise<void> {
  await t.uncovered(token, 'POST', incidentUrl(input, getAddIncidentCommentUrl), {
    comment: input.comentario,
  });
}
