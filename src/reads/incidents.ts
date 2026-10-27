import { z } from 'zod';
import { isFeatureDisabled } from '../domain/backend-errors.js';
import {
  INCIDENT_STATUS_LABELS,
  INCIDENT_STATUS_PARAM,
  INCIDENT_STATUS_PARAMS,
  type IncidentStatus,
} from '../domain/incident-status.js';
import { resolveByName } from '../domain/resolve-by-name.js';
import { fail, ok, type ToolResult } from '../domain/tool-result.js';
import type {
  IncidentRef,
  IncidentTimelineEntry,
  ListaTruncable,
  PatrolTechGateway,
} from '../gateway/index.js';
import {
  failAmbigua,
  failNoEncontrado,
  isFail,
  MAX_OPCIONES,
  okLista,
  TRUNCADO_HINT,
} from './support/results.js';
import { defineRead, type CapabilityContext, type ReadCapability, type ReadEnv } from './types.js';

const incidenciasDesc =
  'Lista las incidencias de la App de Incidencias de la organización, de la más reciente a la más antigua: número en la lista, `id`, título, estado (Abierto, En progreso, Resuelto, Cerrado, Descartado), a quién está asignada y fecha (UTC). Admite filtrar por estado. Úsala para «¿qué incidencias hay abiertas?» o antes de proponer_actualizar_incidencia para saber cuál es (pásale el título o el `id`, no el número).' +
  TRUNCADO_HINT;
const incidenciaDesc =
  'Detalle de UNA incidencia de la App de Incidencias: descripción, estado, prioridad, categoría, quién la reportó y a quién está asignada, checkpoints vinculados, el historial (comentarios y cambios de estado con autor y fecha UTC) y cuántas fotos y vídeos tiene. Úsala cuando pregunten qué pasó en una incidencia, su descripción o sus comentarios. Búscala por su título, su `id` o su número en consultar_incidencias. Las fotos y vídeos no se pueden enviar desde aquí: se ven en el panel (Incidencias).';

const APP_INCIDENCIAS_APAGADA =
  'La App de Incidencias no está activa en esta organización: no hay incidencias. La activa un Admin en el panel, en Apps → Gestión de Incidencias.';
const PRIORIDAD_LABEL: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};
// El historial va al modelo entero hasta 30 entradas; las incidencias
// con más vida se cortan por las más recientes y se avisa.
const MAX_HISTORIAL = 30;

/** Las incidencias, o el fallo de «App apagada» si el backend la tiene desactivada. */
async function listarIncidencias(
  gateway: PatrolTechGateway,
  orgId: string,
  token: string,
  opts?: { estado?: IncidentStatus }
): Promise<ListaTruncable<IncidentRef> | ToolResult<never>> {
  try {
    return await gateway.listIncidents(orgId, token, opts);
  } catch (err) {
    if (isFeatureDisabled(err)) return fail(APP_INCIDENCIAS_APAGADA);
    throw err;
  }
}

/** El valor de un cambio en palabras del panel (los estados y prioridades vienen como códigos). */
function valorCambio(v: string | null): string {
  if (!v) return '(vacío)';
  if (v in INCIDENT_STATUS_LABELS) return INCIDENT_STATUS_LABELS[v as IncidentStatus].es;
  return PRIORIDAD_LABEL[v] ?? v;
}

/** Una entrada del historial en una frase, sin URLs. */
function queEntrada(e: IncidentTimelineEntry): string {
  const adjunto = e.conAdjunto ? ' (con un adjunto)' : '';
  switch (e.tipo) {
    case 'CREATED':
      return `Creó la incidencia${adjunto}`;
    case 'STATUS_CHANGE':
      return `Cambió el estado: ${valorCambio(e.antes)} → ${valorCambio(e.despues)}${e.texto ? `, con el comentario «${e.texto}»` : ''}`;
    case 'PRIORITY_CHANGE':
      return `Cambió la prioridad: ${valorCambio(e.antes)} → ${valorCambio(e.despues)}`;
    case 'ASSIGNMENT_CHANGE':
      return e.despues ? `La asignó a ${e.despues}` : 'Quitó la asignación';
    case 'COMMENT':
      // Un comentario que es solo una foto no lleva texto: sin esto salía «Comentario: «»».
      return e.texto
        ? `Comentario: «${e.texto}»${adjunto}`
        : `Comentario${adjunto ? ' con un adjunto' : ' vacío'}`;
    case 'MEDIA_ADDED':
      return 'Añadió una foto o un vídeo';
    case 'MEDIA_REMOVED':
      return 'Quitó una foto o un vídeo';
    case 'FIELD_EDIT':
      return `Editó la incidencia${e.texto ? `: ${e.texto}` : ''}`;
    default:
      return e.texto ? `${e.tipo}: ${e.texto}` : e.tipo;
  }
}

async function consultarIncidencia(
  gateway: PatrolTechGateway,
  { org, token }: CapabilityContext,
  incidencia: string
): Promise<ToolResult<unknown>> {
  const orgId = org.orgId;
  const lista = await listarIncidencias(gateway, orgId, token);
  if (isFail(lista)) return lista;
  // El número es el de la lista de incidencias SIN filtro (misma lista, mismo orden).
  const etiqueta = (i: IncidentRef) => i.titulo ?? i.id;
  const match = resolveByName(incidencia, lista.items, (i) => i.titulo ?? '', {
    byIndex: true,
    idOf: (i) => i.id,
  });
  if (match.kind === 'ambiguous') {
    return failAmbigua(
      incidencia,
      'incidencias',
      match.matches.slice(0, MAX_OPCIONES).map(etiqueta)
    );
  }
  if (match.kind === 'none') {
    return failNoEncontrado('incidencia', lista.items.slice(0, MAX_OPCIONES).map(etiqueta));
  }
  const ref = match.item;

  const d = await gateway.getIncidentDetail(
    { incidentId: ref.id, organizationId: orgId, locationId: ref.locationId },
    token
  );
  if (!d) {
    return fail(
      'Esa incidencia ya no existe: puede que la hayan borrado. Vuelve a pedir la lista de incidencias.'
    );
  }
  const estado = (INCIDENT_STATUS_LABELS[d.estado] as { es: string } | undefined)?.es ?? d.estado;
  if (d.oculta) {
    return ok(
      { id: d.id, oculta: true, estado, creadaEn: d.creadaEn },
      {
        avisos: [
          'Esta incidencia es más antigua que el periodo de retención de datos de la cuenta: ya no se conserva su detalle (título, descripción ni historial). Díselo así; no inventes nada.',
        ],
      }
    );
  }
  const historial = d.timeline
    .slice(-MAX_HISTORIAL)
    .map((e) => ({ fecha: e.fecha, autor: e.autor, que: queEntrada(e) }));
  const avisos =
    d.timeline.length > MAX_HISTORIAL
      ? [
          `El historial tiene ${d.timeline.length} entradas: van las ${MAX_HISTORIAL} más recientes.`,
        ]
      : [];
  return ok(
    {
      id: d.id,
      titulo: d.titulo,
      descripcion: d.descripcion,
      estado,
      prioridad: PRIORIDAD_LABEL[d.prioridad] ?? d.prioridad,
      categoria: [d.categoria, d.subcategoria].filter(Boolean).join(' / ') || null,
      reportadaPor: d.reportadaPor,
      asignadaA: d.asignadaA,
      creadaEn: d.creadaEn,
      resueltaEn: d.resueltaEn,
      cerradaEn: d.cerradaEn,
      checkpoints: d.checkpoints,
      fotos: d.fotos,
      videos: d.videos,
      historial,
    },
    { avisos }
  );
}

/** Incidencias de la App de Incidencias: la lista y el detalle de una. */
export function incidentReads({ gateway }: ReadEnv): ReadCapability[] {
  return [
    defineRead({
      name: 'consultar_incidencias',
      description: incidenciasDesc,
      params: {
        estado: z
          .enum(INCIDENT_STATUS_PARAMS)
          .optional()
          .describe('Solo las de ese estado. OMÍTELO para verlas todas.'),
      },
      call: async ({ org, token }, { estado }) => {
        const lista = await listarIncidencias(
          gateway,
          org.orgId,
          token,
          estado ? { estado: INCIDENT_STATUS_PARAM[estado] } : undefined
        );
        if (isFail(lista)) return lista;
        const items = lista.items.map((i, n) => ({
          numero: n + 1,
          id: i.id,
          titulo: i.titulo ?? '(oculta por la retención de datos)',
          estado: INCIDENT_STATUS_LABELS[i.estado].es,
          prioridad: PRIORIDAD_LABEL[i.prioridad] ?? i.prioridad,
          asignadoA: i.asignadoAId ? (i.asignadoA ?? 'un usuario') : null,
          fecha: i.creadaEn,
        }));
        return okLista({ ...lista, items }, 'incidencias');
      },
    }),
    defineRead({
      name: 'consultar_incidencia',
      description: incidenciaDesc,
      params: {
        incidencia: z
          .string()
          .min(1)
          .describe(
            'Título (o parte), `id` o número en la lista de incidencias (sin filtro de estado)'
          ),
      },
      call: async (ctx, { incidencia }) => consultarIncidencia(gateway, ctx, incidencia),
    }),
  ];
}
