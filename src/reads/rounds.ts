import { z } from 'zod';
import { localToUtc } from '../domain/timezone.js';
import { fail, ok, type ToolResult } from '../domain/tool-result.js';
import type {
  PatrolTechGateway,
  RoundCheckpointsResult,
  RoundRef,
  RouteRef,
} from '../gateway/index.js';
import { rutaParamSchema } from './support/params.js';
import { resolveRuta } from './support/resolve.js';
import {
  failAmbigua,
  failNoEncontrado,
  isFail,
  okLista,
  TRUNCADO_HINT,
} from './support/results.js';
import { defineRead, type ReadCapability, type ReadEnv } from './types.js';

const rondasDesc =
  'Consulta el estado de las rondas de la cuenta del usuario (abiertas, completadas, incompletas) de los últimos `windowDays` días.';
const rondasDetalleDesc =
  'Consulta el detalle de las rondas/rutas de la organización: cada ruta con sus rondas recientes (estado, vigilante, checkpoints completados de total, horas). Úsala cuando el usuario pida ver el detalle de las rondas, cómo van las rutas, o el estado de rondas concretas. Si una ruta trae `error`, sus rondas NO se pudieron leer: no digas que no tiene rondas.' +
  TRUNCADO_HINT;
const checkpointsRondaDesc =
  'Consulta el detalle por punto de control de la ÚLTIMA ronda de una ruta: qué checkpoints se escanearon (con hora) y cuáles faltan. Úsala cuando el usuario pregunte qué puntos faltan/se hicieron en una ronda, o el detalle de checkpoints de una ruta concreta. Si el usuario NO indica la ruta, llámala igualmente SIN el parámetro `ruta`: si solo hay una ruta activa la usará, y si hay varias devolverá la lista de rutas para que el usuario elija (no le pidas la ruta a ciegas).';
const rondaDesc =
  'Consulta UNA ronda concreta de una ruta: estado, vigilante, inicio y fin, y qué checkpoints se hicieron (con hora) y cuáles quedaron pendientes. Sin `fecha` devuelve la ÚLTIMA ronda. Para una ronda concreta pasa `fecha` (día del cliente) y, si lo sabes, `hora` aproximada: «anoche» → fecha de ayer y hora 23:00; «esta mañana» → hoy y 08:00. Si ese día hubo más rondas, vienen en `otrasRondasCercanas`. Si el usuario no dice la ruta, llámala sin `ruta`: si hay varias, devuelve la lista para preguntar. Las horas vienen en UTC.';
const rondaParamSchema = {
  ruta: rutaParamSchema.ruta,
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa exactamente YYYY-MM-DD')
    .optional()
    .describe(
      'Día de la ronda en el calendario del cliente, YYYY-MM-DD. OMÍTELO para la última ronda.'
    ),
  hora: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Usa exactamente HH:mm')
    .optional()
    .describe('Hora aproximada de inicio, HH:mm en la hora del cliente. Solo junto con `fecha`.'),
};

const ROUNDS_PAGE_SIZE = 50;
// Hasta 300 rondas hacia atrás: el backend no filtra rondas por fecha, hay que paginar.
const MAX_ROUND_PAGES = 6;
const HORA_MS = 3600_000;
const MAX_RONDAS_CERCANAS = 5;

/** Avisos de las rutas cuyas rondas no se pudieron leer (no son "rutas sin rondas"). */
const avisosRutasConError = (rutas: { routeName: string; error?: string }[]): string[] => {
  const conError = rutas.filter((r) => r.error).map((r) => r.routeName);
  return conError.length > 0
    ? [
        `No se pudieron leer las rondas de: ${conError.join(', ')}. NO digas que esas rutas no tienen rondas.`,
      ]
    : [];
};

/** Traduce el resultado del gateway: solo `found` y "no hay rondas" son respuestas con datos. */
function checkpointsRondaResult(
  result: RoundCheckpointsResult
): ToolResult<RoundCheckpointsResult> {
  if (result.found) return ok(result);
  if (result.reason === 'route_ambiguous') {
    return failAmbigua('el nombre indicado', 'rutas', result.opciones);
  }
  if (result.reason === 'route_not_found') return failNoEncontrado('ruta', result.opciones);
  if (result.reason === 'route_not_specified') {
    return fail(
      'ruta no indicada: hay varias, pregunta al usuario cuál de estas quiere',
      result.opciones
    );
  }
  // no_rondas: es un hecho, no un fallo (la ruta existe y no tiene rondas aún).
  return ok(result);
}

async function rondaConDetalle(
  gateway: PatrolTechGateway,
  token: string,
  ruta: RouteRef,
  ronda: RoundRef
) {
  const detalle = await gateway.getRoundDetail(ruta.id, ronda.id, token);
  return {
    ruta: ruta.name,
    estado: detalle.status,
    vigilante: ronda.patrollerName,
    inicio: ronda.startTime,
    fin: ronda.endTime,
    escaneados: detalle.scannedCount,
    total: detalle.totalCount,
    hechos: detalle.checkpoints
      .filter((c) => c.scanned)
      .map((c) => ({ checkpoint: c.checkpointName, hora: c.scanTime })),
    pendientes: detalle.checkpoints.filter((c) => !c.scanned).map((c) => c.checkpointName),
  };
}

/**
 * La ronda pedida con sus puntos hechos y pendientes. Sin `cuando`, la última;
 * con fecha, la que empezó más cerca de esa fecha y hora (mediodía si no hay
 * hora), dentro de ±6 h con hora o ±12 h sin ella. Las rondas no se filtran
 * por fecha en el backend: se pagina hacia atrás hasta pasar la ventana.
 */
async function consultarRonda(
  gateway: PatrolTechGateway,
  token: string,
  ruta: RouteRef,
  cuando?: { fecha: string; hora?: string; tz: string }
): Promise<ToolResult<unknown>> {
  if (!cuando) {
    const { items } = await gateway.getRouteRounds(ruta.id, token, { page: 1, limit: 1 });
    if (!items[0]) {
      return ok({ ruta: ruta.name, ronda: null, motivo: 'esta ruta todavía no tiene rondas' });
    }
    return ok(await rondaConDetalle(gateway, token, ruta, items[0]));
  }

  const objetivo = localToUtc(`${cuando.fecha}T${cuando.hora ?? '12:00'}`, cuando.tz).getTime();
  const tolerancia = (cuando.hora ? 6 : 12) * HORA_MS;
  const vistas: RoundRef[] = [];
  let agotado = false;
  for (let page = 1; ; page++) {
    const { items, totalPages } = await gateway.getRouteRounds(ruta.id, token, {
      page,
      limit: ROUNDS_PAGE_SIZE,
    });
    vistas.push(...items);
    const masAntigua = items.at(-1);
    if (
      !masAntigua ||
      Date.parse(masAntigua.startTime) < objetivo - tolerancia ||
      page >= totalPages
    ) {
      break;
    }
    if (page >= MAX_ROUND_PAGES) {
      agotado = true;
      break;
    }
  }

  const distancia = (r: RoundRef): number => Math.abs(Date.parse(r.startTime) - objetivo);
  const cercanas = [...vistas].sort((a, b) => distancia(a) - distancia(b));
  const enVentana = cercanas.filter((r) => distancia(r) <= tolerancia);
  if (enVentana.length === 0) {
    if (agotado) {
      return fail(
        `No he encontrado esa ronda entre las ${vistas.length} más recientes de «${ruta.name}»: es demasiado antigua para consultarla desde aquí; puede verla en el panel (Rutas).`
      );
    }
    return fail(
      `No hay ninguna ronda de «${ruta.name}» cerca de esa fecha. Estas son las más próximas (hora de inicio en UTC); pregunta cuál quiere:`,
      cercanas.slice(0, MAX_RONDAS_CERCANAS).map((r) => r.startTime)
    );
  }
  const [elegida, ...resto] = enVentana;
  const otrasRondasCercanas = resto.slice(0, MAX_RONDAS_CERCANAS).map((r) => ({
    inicio: r.startTime,
    estado: r.status,
    vigilante: r.patrollerName,
  }));
  return ok({ ...(await rondaConDetalle(gateway, token, ruta, elegida)), otrasRondasCercanas });
}

/** Rondas: estado general, detalle por ruta, checkpoints de la última y una ronda concreta. */
export function roundReads({ gateway }: ReadEnv): ReadCapability[] {
  return [
    defineRead({
      name: 'consultar_estado_rondas',
      description: rondasDesc,
      params: {},
      call: async ({ org, token }) => ok(await gateway.getRoundsStatus(org.orgId, token)),
    }),
    defineRead({
      name: 'consultar_detalles_rondas',
      description: rondasDetalleDesc,
      params: {},
      call: async ({ org, token }) => {
        const rutas = await gateway.getRoundsDetail(org.orgId, token);
        return okLista(rutas, 'rutas', avisosRutasConError(rutas.items));
      },
    }),
    defineRead({
      name: 'consultar_checkpoints_ronda',
      description: checkpointsRondaDesc,
      params: rutaParamSchema,
      call: async ({ org, token }, { ruta }) =>
        checkpointsRondaResult(await gateway.getRoundCheckpoints(org.orgId, token, ruta)),
    }),
    defineRead({
      name: 'consultar_ronda',
      description: rondaDesc,
      params: rondaParamSchema,
      call: async ({ org, token, tz }, { ruta, fecha, hora }) => {
        const r = resolveRuta(ruta, (await gateway.listRoutes(org.orgId, token)).items);
        if (isFail(r)) return r;
        return consultarRonda(gateway, token, r.item, fecha ? { fecha, hora, tz } : undefined);
      },
    }),
  ];
}
