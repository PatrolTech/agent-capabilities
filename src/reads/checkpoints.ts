import { z } from 'zod';
import { resolveDateRange } from '../domain/date-range.js';
import { ok, type ToolResult } from '../domain/tool-result.js';
import type { PatrolTechGateway } from '../gateway/index.js';
import { scansFiltrosSchema } from './support/params.js';
import { resolveNamed, UBICACION } from './support/resolve.js';
import {
  avisosUbicaciones,
  avisoTruncado,
  isFail,
  okLista,
  TRUNCADO_HINT,
} from './support/results.js';
import { DIA_MS, MAX_FILAS, paginarEscaneos, resolverFiltrosEscaneos } from './support/scans.js';
import { defineRead, type CapabilityContext, type ReadCapability, type ReadEnv } from './types.js';

const checkpointsDesc =
  'Lista TODOS los puntos de control (checkpoints) configurados en la organización, con su ubicación y su `identificador`: el código de 8 caracteres de la columna «Identificador» del panel, el que se teclea en el «Código manual» de la app. Úsala para saber qué checkpoints existen o cuando pidan los identificadores. Para saber cuáles NO se han revisado o llevan más tiempo sin escanearse, usa consultar_checkpoints_sin_revisar.' +
  TRUNCADO_HINT;
const sinRevisarDesc =
  'Checkpoints ordenados por los días que llevan sin escanearse: primero los que nunca se han escaneado y luego de más a menos días. Cada uno con su ubicación, `ultimoEscaneo` (UTC) y `diasSinEscanear`. Úsala para «¿qué checkpoints llevan más tiempo sin revisarse?», «¿qué puntos no se han hecho esta semana?». Con `alMenos: true` el último escaneo es más antiguo que lo que se ha podido leer: di «más de N días». Con `sinEscaneosVisibles: true` no hay ningún escaneo suyo visible (nunca, o anteriores a la retención de datos del plan).';
const scansDesc =
  'Consulta los escaneos/fichajes registrados en la organización, con checkpoint, vigilante, fecha y si hay sospecha de fraude. Úsala cuando el usuario pida ver los últimos escaneos, fichajes recientes o detalle de actividad reciente. ADMITE FILTRO POR FECHA/PERIODO: el usuario puede pedir "hoy", "ayer", "última semana", "últimos 30 días", "todos" o un rango de fechas concreto (desde/hasta); pásaselo en los parámetros correspondientes en vez de decir que no puedes filtrar por fecha.' +
  ' ADMITE FILTROS: `vigilante`, `checkpoint` y `ubicacion` por su nombre, `solo_sospechosos` y `solo_no_validos` (rechazados); úsalos para «escaneos de Juan ayer», «los sospechosos de esta semana» o «los del almacén» en vez de traer los últimos de todos.' +
  ' Cada escaneo trae `validacion` (si es válido, está pendiente de revisión o se rechazó, con su motivo) y `motivosSospecha` (vacío si no es sospechoso). «Sospechoso» y «válido» son cosas distintas: un escaneo puede ser válido y a la vez sospechoso. Explica el estado y el motivo usando SOLO `validacion` y `motivosSospecha`; nunca adivines causas («duplicado», «problema de sincronización», «timing anomalies»…).' +
  ' Si vienen, cada escaneo trae también `dispositivo` (modelo, sistema, `bateriaPct`, `cargando`, `conexion`) y `distanciaGpsM`/`precisionGpsM` (metros al punto y precisión del GPS según la regla de proximidad). Si no vienen, no los supongas.' +
  TRUNCADO_HINT;

interface FilaSinRevisar {
  checkpoint: string;
  ubicacion: string;
  ultimoEscaneo: string | null;
  diasSinEscanear: number | null;
  nuncaEscaneado?: true;
  alMenos?: true;
  sinEscaneosVisibles?: true;
  sinDatos?: true;
}

async function checkpointsSinRevisar(
  gateway: PatrolTechGateway,
  { org, token }: CapabilityContext,
  args: { ubicacion?: string; dias_minimos?: number }
): Promise<ToolResult<unknown>> {
  const orgId = org.orgId;
  const lista = await gateway.listCheckpoints(orgId, token);
  let checkpoints = lista.items;
  if (args.ubicacion) {
    const ubicaciones = await gateway.listLocations(orgId, token);
    const u = resolveNamed(args.ubicacion, ubicaciones, (l) => l.name, UBICACION);
    if (isFail(u)) return u;
    checkpoints = checkpoints.filter((c) => c.locationId === u.item.id);
  }

  // El escaneo solo trae el nombre del checkpoint: se busca ubicación a ubicación.
  const clave = (locationId: string, nombre: string): string => `${locationId}\u0000${nombre}`;
  const ultimo = new Map<string, string>();
  const leidoHasta = new Map<string, string>();
  const sinLeer = new Set<string>();
  const porUbicacion = new Map<string, Set<string>>();
  for (const c of checkpoints) {
    if (c.primerEscaneo === null) continue; // nunca escaneado: lo dice el backend
    porUbicacion.set(c.locationId, (porUbicacion.get(c.locationId) ?? new Set()).add(c.name));
  }
  // La API no da el último escaneo de cada checkpoint: se deduce de
  // los escaneos más recientes, leyendo como mucho 2.000 (20 páginas) entre todas
  // las ubicaciones; lo que no aparezca ahí se da como «al menos N días».
  let presupuesto = MAX_FILAS;
  let leidos = 0;
  for (const [locationId, pendientes] of porUbicacion) {
    if (presupuesto <= 0) {
      sinLeer.add(locationId);
      continue;
    }
    const { escaneos, hayMas } = await paginarEscaneos(
      gateway,
      orgId,
      token,
      { locationId },
      {
        maxFilas: presupuesto,
        seguir: (pagina) => {
          for (const s of pagina) {
            if (s.checkpointName && pendientes.delete(s.checkpointName)) {
              ultimo.set(clave(locationId, s.checkpointName), s.timestamp);
            }
          }
          return pendientes.size > 0;
        },
      }
    );
    presupuesto -= escaneos.length;
    leidos += escaneos.length;
    const masAntiguo = escaneos.at(-1)?.timestamp;
    if (pendientes.size > 0 && hayMas && masAntiguo) leidoHasta.set(locationId, masAntiguo);
  }

  const ahora = Date.now();
  const dias = (iso: string): number => Math.floor((ahora - Date.parse(iso)) / DIA_MS);
  const filas = checkpoints.map((c): FilaSinRevisar => {
    const base = {
      checkpoint: c.name,
      ubicacion: c.locationName,
      ultimoEscaneo: null,
      diasSinEscanear: null,
    };
    if (c.primerEscaneo === null) return { ...base, nuncaEscaneado: true };
    const u = ultimo.get(clave(c.locationId, c.name));
    if (u) return { ...base, ultimoEscaneo: u, diasSinEscanear: dias(u) };
    const hasta = leidoHasta.get(c.locationId);
    if (hasta) return { ...base, diasSinEscanear: dias(hasta), alMenos: true };
    if (sinLeer.has(c.locationId)) return { ...base, sinDatos: true };
    return { ...base, sinEscaneosVisibles: true };
  });
  const prioridad = (f: FilaSinRevisar): number =>
    f.nuncaEscaneado ? 3 : f.sinEscaneosVisibles ? 2 : f.sinDatos ? 0 : 1;
  const ordenadas = filas
    .filter(
      (f) =>
        !args.dias_minimos ||
        f.diasSinEscanear === null ||
        f.alMenos === true ||
        f.diasSinEscanear >= args.dias_minimos
    )
    .sort(
      (a, b) => prioridad(b) - prioridad(a) || (b.diasSinEscanear ?? 0) - (a.diasSinEscanear ?? 0)
    );

  const avisos = avisosUbicaciones(lista.ubicacionesConError);
  if (lista.truncado) avisos.push(avisoTruncado(lista.items.length, lista.total, 'checkpoints'));
  if (leidoHasta.size > 0 || sinLeer.size > 0) {
    avisos.push(
      `Se han leído los ${leidos} escaneos más recientes: los que traen \`alMenos: true\` llevan COMO MÍNIMO esos días sin escanearse, y los que traen \`sinDatos: true\` no se han podido comprobar (acota con \`ubicacion\`).`
    );
  }
  return ok({ checkpoints: ordenadas }, { truncado: lista.truncado || sinLeer.size > 0, avisos });
}

/** Checkpoints: los configurados, los que llevan más sin revisarse y sus escaneos. */
export function checkpointReads({ gateway }: ReadEnv): ReadCapability[] {
  return [
    defineRead({
      name: 'consultar_ultimos_scans',
      description: scansDesc,
      params: scansFiltrosSchema,
      call: async ({ org, token, tz }, args) => {
        const filtros = await resolverFiltrosEscaneos(gateway, org.orgId, token, args);
        if (isFail(filtros)) return filtros;
        const { dateFrom, dateTo, limit, avisos } = resolveDateRange(
          args.periodo,
          args.desde,
          args.hasta,
          new Date(),
          tz
        );
        const scans = await gateway.getRecentScans(org.orgId, token, {
          limit,
          dateFrom,
          dateTo,
          ...filtros,
        });
        return okLista(scans, 'escaneos', avisos ?? []);
      },
    }),
    defineRead({
      name: 'obtener_checkpoints',
      description: checkpointsDesc,
      params: {},
      call: async ({ org, token }) => {
        const checkpoints = await gateway.getCheckpoints(org.orgId, token);
        return okLista(
          checkpoints,
          'checkpoints',
          avisosUbicaciones(checkpoints.ubicacionesConError)
        );
      },
    }),
    defineRead({
      name: 'consultar_checkpoints_sin_revisar',
      description: sinRevisarDesc,
      params: {
        ubicacion: z
          .string()
          .min(1)
          .optional()
          .describe('Solo los checkpoints de esa ubicación. OMÍTELO para todas.'),
        dias_minimos: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'Solo los que llevan al menos estos días sin escanearse. OMÍTELO para verlos todos.'
          ),
      },
      call: async (ctx, args) => checkpointsSinRevisar(gateway, ctx, args),
    }),
  ];
}
