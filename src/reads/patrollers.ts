import { z } from 'zod';
import { resolveDateRange, type Periodo } from '../domain/date-range.js';
import { guardAppMessage } from '../domain/guard-app-message.js';
import { validationBucket } from '../domain/scan-explanation.js';
import { ok, type ToolResult } from '../domain/tool-result.js';
import type {
  PatrolTechGateway,
  PatrollerRanking,
  PatrollerStatsResult,
} from '../gateway/index.js';
import { scansParamSchema } from './support/params.js';
import {
  avisoTruncado,
  failAmbigua,
  failNoEncontrado,
  isFail,
  okLista,
  TRUNCADO_HINT,
} from './support/results.js';
import { resolveNamed, VIGILANTE } from './support/resolve.js';
import { paginarEscaneos } from './support/scans.js';
import { defineRead, type CapabilityContext, type ReadCapability, type ReadEnv } from './types.js';

const vigilantesDesc =
  'Consulta la última actividad y el estado de los vigilantes de la cuenta del usuario.' +
  TRUNCADO_HINT;
const statsVigilanteDesc =
  "Consulta las estadísticas de un vigilante concreto por su nombre: total de escaneos, rondas completadas/totales, tasa de finalización y tiempo medio entre escaneos. Úsala cuando el usuario pregunte por un vigilante específico (p. ej. '¿cómo va Juan García?', 'estadísticas de María'). Si el resultado trae `ambigua`, el nombre casa con varios vigilantes: pregunta cuál.";
const rankingDesc =
  "Consulta el ranking de vigilantes de la organización: cada uno con sus escaneos, rondas completadas y tasa de finalización (ordenado de mejor a peor), más un resumen del equipo y los checkpoints más escaneados. Admite periodo/fechas. Úsala para '¿quién va mejor/peor?', 'ranking de vigilantes', 'cómo va el equipo', 'qué checkpoint se escanea más'." +
  TRUNCADO_HINT;
const escaneosPorVigilanteDesc =
  'Recuento de escaneos por vigilante en un periodo (por defecto los últimos 7 días): total, válidos, sospechosos, no válidos (rechazados) y pendientes de revisión, ordenado de más a menos escaneos (`puesto`). Incluye a los vigilantes sin ningún escaneo. Úsala para «¿cuántos escaneos ha hecho cada vigilante?», «ranking por escaneos», «¿quién tiene más sospechosos?». Válido y sospechoso son independientes: un escaneo puede ser las dos cosas. Para rondas completadas y tasa de finalización usa consultar_ranking_vigilantes.';
const enlacesAppDesc =
  'Devuelve el enlace de la app de cada vigilante (abre la app con ese vigilante ya elegido) y el enlace general de la organización (pide elegir el vigilante al entrar). Con `vigilante`, solo el suyo y `mensajeParaReenviar`: un mensaje ya escrito con su nombre y SU enlace para que el cliente se lo reenvíe por WhatsApp o email (qué es, su enlace y cómo instalar o abrir la app); dalo tal cual. Úsala cuando pida los enlaces o el acceso a la app de sus vigilantes, o cómo hacerle llegar la app a un vigilante (no se le puede enviar desde aquí al vigilante: compártelo tú, es decir, el cliente, con el vigilante). Cada enlace permite entrar como ESE vigilante sin contraseña: al darlos, avisa de que reenvíe cada uno SOLO a su vigilante, nunca a un grupo.' +
  TRUNCADO_HINT;

/** Traduce el resultado del gateway a `ToolResult`: ambigua y no-encontrado son fallos, no datos. */
function statsVigilanteResult(result: PatrollerStatsResult): ToolResult<PatrollerStatsResult> {
  if (result.found) return ok(result);
  if (result.ambigua) return failAmbigua('el nombre indicado', 'vigilantes', result.opciones);
  return failNoEncontrado('vigilante', result.opciones);
}

/** El ranking no es una `ListaTruncable`, pero avisa del cap igual que las demás. */
function okRanking(ranking: PatrollerRanking, avisosExtra: string[]): ToolResult<PatrollerRanking> {
  const avisos = [...avisosExtra];
  if (ranking.truncado) {
    avisos.push(avisoTruncado(ranking.ranking.length, undefined, 'vigilantes del ranking'));
  }
  return ok(ranking, { truncado: ranking.truncado, avisos });
}

async function escaneosPorVigilante(
  gateway: PatrolTechGateway,
  { org, token, tz }: CapabilityContext,
  args: { periodo?: Periodo; desde?: string; hasta?: string }
): Promise<ToolResult<unknown>> {
  const periodo = args.periodo ?? (args.desde || args.hasta ? undefined : 'ultimos_7_dias');
  const { dateFrom, dateTo, avisos } = resolveDateRange(
    periodo,
    args.desde,
    args.hasta,
    new Date(),
    tz
  );
  const [{ escaneos, hayMas }, vigilantes] = await Promise.all([
    paginarEscaneos(gateway, org.orgId, token, { dateFrom, dateTo }),
    gateway.listPatrollers(org.orgId, token),
  ]);

  const vacio = () => ({
    total: 0,
    validos: 0,
    sospechosos: 0,
    noValidos: 0,
    pendientesRevision: 0,
  });
  const cuenta = new Map(vigilantes.items.map((v) => [v.name, vacio()]));
  for (const s of escaneos) {
    const nombre = s.patrollerName ?? '(sin vigilante)';
    const c = cuenta.get(nombre) ?? vacio();
    cuenta.set(nombre, c);
    c.total += 1;
    if (s.fraudFlagged) c.sospechosos += 1;
    const estado = validationBucket(s.validacion);
    if (estado === 'valido') c.validos += 1;
    else if (estado === 'rechazado') c.noValidos += 1;
    else if (estado === 'pendiente') c.pendientesRevision += 1;
  }
  const ranking = [...cuenta]
    .map(([vigilante, c]) => ({ vigilante, ...c }))
    .sort((a, b) => b.total - a.total)
    .map((r, i) => ({ puesto: i + 1, ...r }));

  const todosAvisos = [...(avisos ?? [])];
  if (hayMas) {
    todosAvisos.push(
      `Solo se han contado los ${escaneos.length} escaneos más recientes del periodo: los recuentos son PARCIALES. Díselo y ofrécele acotar el periodo.`
    );
  }
  if (vigilantes.truncado) {
    todosAvisos.push(avisoTruncado(vigilantes.items.length, vigilantes.total, 'vigilantes'));
  }
  return ok(
    { desde: dateFrom ?? null, hasta: dateTo ?? null, totalEscaneos: escaneos.length, ranking },
    { truncado: hayMas || vigilantes.truncado, avisos: todosAvisos }
  );
}

/** Vigilantes: actividad, estadísticas, rankings y enlaces de la app. */
export function patrollerReads({ gateway, urls }: ReadEnv): ReadCapability[] {
  return [
    defineRead({
      name: 'consultar_actividad_vigilantes',
      description: vigilantesDesc,
      params: {},
      call: async ({ org, token }) =>
        okLista(await gateway.getPatrollerActivity(org.orgId, token), 'vigilantes'),
    }),
    defineRead({
      name: 'consultar_stats_vigilante',
      description: statsVigilanteDesc,
      params: {
        vigilante: z
          .string()
          .min(1)
          .describe('Nombre del vigilante/patrullero (nunca vacío: si no lo sabes, pregúntalo)'),
      },
      call: async ({ org, token }, { vigilante }) =>
        statsVigilanteResult(await gateway.getPatrollerStats(org.orgId, token, vigilante)),
    }),
    defineRead({
      name: 'consultar_ranking_vigilantes',
      description: rankingDesc,
      params: scansParamSchema,
      call: async ({ org, token, tz }, { periodo, desde, hasta }) => {
        const { dateFrom, dateTo, avisos } = resolveDateRange(
          periodo,
          desde,
          hasta,
          new Date(),
          tz
        );
        const ranking = await gateway.getPatrollerRanking(org.orgId, token, { dateFrom, dateTo });
        return okRanking(ranking, avisos ?? []);
      },
    }),
    defineRead({
      name: 'consultar_escaneos_por_vigilante',
      description: escaneosPorVigilanteDesc,
      params: scansParamSchema,
      call: async (ctx, args) => escaneosPorVigilante(gateway, ctx, args),
    }),
    defineRead({
      name: 'enlaces_app_vigilantes',
      description: enlacesAppDesc,
      params: {
        vigilante: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Nombre del vigilante al que se le va a mandar: devuelve su enlace y el mensaje para reenviárselo. OMÍTELO para ver los enlaces de todos.'
          ),
        idioma: z
          .enum(['es', 'en', 'fr'])
          .optional()
          .describe(
            "Idioma del mensaje para reenviar: 'es', 'en' o 'fr' (en otro idioma, 'en'); OMÍTELO si es español."
          ),
      },
      call: async ({ org, token }, { vigilante, idioma }) => {
        const vigilantes = await gateway.listPatrollers(org.orgId, token);
        const base = `${urls.app}/${org.orgId}`;
        const enlaceDe = (p: { identifier: string }) => `${base}/${p.identifier}`;
        const avisos = [
          'Cada enlace permite entrar en la app como ESE vigilante sin contraseña: reenvía cada enlace SOLO a su vigilante, nunca a un grupo. El enlace general pide elegir el vigilante al entrar.',
        ];
        if (vigilante) {
          const r = resolveNamed(vigilante, vigilantes.items, (p) => p.name, VIGILANTE);
          if (isFail(r)) return r;
          return ok(
            {
              enlaceGeneral: base,
              enlaces: [{ vigilante: r.item.name, enlace: enlaceDe(r.item) }],
              mensajeParaReenviar: guardAppMessage(r.item.name, enlaceDe(r.item), idioma ?? 'es'),
            },
            { avisos }
          );
        }
        if (vigilantes.truncado) {
          avisos.push(avisoTruncado(vigilantes.items.length, vigilantes.total, 'vigilantes'));
        }
        return ok(
          {
            enlaceGeneral: base,
            enlaces: vigilantes.items.map((p) => ({ vigilante: p.name, enlace: enlaceDe(p) })),
          },
          { truncado: vigilantes.truncado, avisos }
        );
      },
    }),
  ];
}
