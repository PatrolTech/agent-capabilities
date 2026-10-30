import {
  addIncidentComment,
  assignIncident as sdkAssignIncident,
  getAddIncidentCommentUrl,
  getAssignIncidentUrl,
  getGetIncidentDetailUrl,
  getIncidentDetail as sdkGetIncidentDetail,
  getListIncidentsUrl,
  getUpdateIncidentStatusUrl,
  listIncidents as sdkListIncidents,
  updateIncidentStatus as sdkUpdateIncidentStatus,
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
 * Ámbito de una incidencia, en la query de detalle, estado, asignación y comentarios:
 * la API comprueba con él que la App de incidencias está activa y el rol del usuario
 * (sin la ubicación solo vale el rol de organización y un editor de ubicación
 * recibiría 403). Con `locationId` la API deduce la organización de la ubicación.
 */
type IncidentScope = { locationId: string } | { organizationId: string };

function incidentScope(t: IncidentTarget): IncidentScope {
  return t.locationId ? { locationId: t.locationId } : { organizationId: t.organizationId };
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
  const id = target.incidentId;
  const scope = incidentScope(target);
  let i: IncidentDetailItem;
  try {
    i = await t.data(token, getGetIncidentDetailUrl(id, scope), (init) =>
      sdkGetIncidentDetail(id, scope, init)
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
  const id = input.incidentId;
  const scope = incidentScope(input);
  const body = {
    status: input.estado,
    ...(input.comentario ? { comment: input.comentario } : {}),
  };
  await t.envelope(token, getUpdateIncidentStatusUrl(id, scope), (init) =>
    sdkUpdateIncidentStatus(id, body, scope, init)
  );
}

export async function assignIncident(
  t: SdkTransport,
  input: IncidentTarget & { userId: string },
  token: string
): Promise<void> {
  const id = input.incidentId;
  const scope = incidentScope(input);
  await t.envelope(token, getAssignIncidentUrl(id, scope), (init) =>
    sdkAssignIncident(id, { assignToUserId: input.userId }, scope, init)
  );
}

export async function commentIncident(
  t: SdkTransport,
  input: IncidentTarget & { comentario: string },
  token: string
): Promise<void> {
  const id = input.incidentId;
  const scope = incidentScope(input);
  await t.envelope(token, getAddIncidentCommentUrl(id, scope), (init) =>
    addIncidentComment(id, { comment: input.comentario }, scope, init)
  );
}
