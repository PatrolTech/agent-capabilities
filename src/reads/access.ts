import type { z } from 'zod';
import { TIPO_ACCESO } from '../domain/access-logs-csv.js';
import { resolveDateRange } from '../domain/date-range.js';
import { fechaLocal } from '../domain/csv.js';
import { ok, type ToolResult } from '../domain/tool-result.js';
import type { AccessLogEntry, PatrolTechGateway } from '../gateway/index.js';
import {
  avisoUbicacionesSinLeer,
  porUbicacion,
  TIPO_PARAM,
  ubicacionesAccesos,
} from './support/access-locations.js';
import { accesosParamSchema } from './support/params.js';
import { isFail } from './support/results.js';
import { DIA_MS } from './support/scans.js';
import { defineRead, type CapabilityContext, type ReadCapability, type ReadEnv } from './types.js';

const accesosDesc =
  'Historial del Control de Acceso (App de Control de Acceso): entradas y salidas de personas autorizadas y visitantes. Por defecto, las últimas 24 h de todas las ubicaciones. Devuelve los totales (entradas y salidas) y los 20 registros más recientes con hora LOCAL del cliente, tipo, quién, zona y ubicación. Con `solo_dentro: true`, quién ha entrado y aún no ha salido. Úsala para «¿quién ha entrado hoy?», «accesos de anoche», «¿quién está dentro?». Para el listado completo en Excel, enviar_excel_accesos. Nunca escribas en el chat el documento de un visitante.';

const ULTIMOS_ACCESOS = 20;

/** Quién, en una frase y SIN el documento del visitante. */
function quienAcceso(a: AccessLogEntry): string {
  if (a.oculto) return '(oculto por la retención de datos)';
  if (a.persona) return a.persona;
  if (a.visitante) {
    return `${a.visitante} (visitante${a.empresaVisitante ? `, ${a.empresaVisitante}` : ''})`;
  }
  return '(sin nombre)';
}

/** `YYYY-MM-DD HH:mm` en la hora del cliente. */
function horaLocal(iso: string, tz: string): string {
  return fechaLocal(iso, tz).slice(0, 16);
}

async function consultarAccesos(
  gateway: PatrolTechGateway,
  { org, token, tz }: CapabilityContext,
  args: z.infer<z.ZodObject<typeof accesosParamSchema>>,
  { conExcel }: { conExcel: boolean }
): Promise<ToolResult<unknown>> {
  const u = await ubicacionesAccesos(gateway, org.orgId, token, args.ubicacion);
  if (isFail(u)) return u;
  const nombreDe = (id: string): string => u.ubicaciones.find((l) => l.id === id)?.name ?? id;

  if (args.solo_dentro) {
    const r = await porUbicacion(u.ubicaciones, (l) =>
      gateway.listActiveAccessEntries(l.id, token, args.zona)
    );
    if (isFail(r)) return r;
    const activas = r.resultados
      .flatMap((x) => x.valor)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    // Una entrada sin salida de hace meses es una salida que no se registró, no alguien dentro
    // (en staging, 17 «activas» de febrero y marzo): pasadas 24 h van aparte.
    const limite = new Date(Date.now() - DIA_MS).toISOString();
    const dentro = activas.filter((a) => a.fecha >= limite);
    const antiguas = activas.filter((a) => a.fecha < limite);
    const fila = (a: AccessLogEntry) => ({
      desde: horaLocal(a.fecha, tz),
      quien: quienAcceso(a),
      zona: a.zona,
      ubicacion: nombreDe(a.locationId),
    });
    const avisos = [...u.avisos, ...avisoUbicacionesSinLeer(r.conError)];
    if (antiguas.length > 0) {
      avisos.push(
        `${antiguas.length} entrada(s) de hace más de 24 h siguen sin salida registrada (la más antigua, del ${horaLocal(antiguas[antiguas.length - 1].fecha, tz).slice(0, 10)}): ` +
          'NO las cuentes como dentro ahora; lo más probable es que no se registrara la salida. Díselo así.'
      );
    }
    return ok(
      {
        dentroAhora: dentro.length,
        personas: dentro.slice(0, ULTIMOS_ACCESOS).map(fila),
        ...(antiguas.length > 0
          ? {
              sinSalidaRegistrada: antiguas.length,
              entradasSinSalida: antiguas.slice(0, ULTIMOS_ACCESOS).map(fila),
            }
          : {}),
      },
      { avisos }
    );
  }

  // Sin periodo, las últimas 24 h (no «hoy»: a las 8:00 «hoy» se deja la noche fuera).
  const ahora = new Date();
  const rango =
    args.periodo || args.desde || args.hasta
      ? resolveDateRange(args.periodo, args.desde, args.hasta, ahora, tz)
      : {
          dateFrom: new Date(ahora.getTime() - DIA_MS).toISOString(),
          dateTo: ahora.toISOString(),
          avisos: undefined,
        };
  const tipo = args.tipo ? TIPO_PARAM[args.tipo] : undefined;
  const base = { zona: args.zona, tipo, desde: rango.dateFrom, hasta: rango.dateTo };

  const r = await porUbicacion(u.ubicaciones, async (l) => {
    const pagina = await gateway.listAccessLogs(
      { ...base, locationId: l.id, page: 1, limit: ULTIMOS_ACCESOS },
      token
    );
    // Sin filtro de tipo, una consulta de 1 fila más da el total de entradas (las salidas son el resto).
    const entradas = tipo
      ? tipo === 'ENTRY'
        ? pagina.total
        : 0
      : (
          await gateway.listAccessLogs(
            { ...base, locationId: l.id, tipo: 'ENTRY', page: 1, limit: 1 },
            token
          )
        ).total;
    return { ...pagina, entradas };
  });
  if (isFail(r)) return r;

  const total = r.resultados.reduce((n, x) => n + x.valor.total, 0);
  const entradas = r.resultados.reduce((n, x) => n + x.valor.entradas, 0);
  const ultimos = r.resultados
    .flatMap((x) => x.valor.items)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, ULTIMOS_ACCESOS)
    .map((a) => ({
      hora: horaLocal(a.fecha, tz),
      tipo: TIPO_ACCESO[a.tipo],
      quien: quienAcceso(a),
      zona: a.zona,
      ubicacion: nombreDe(a.locationId),
    }));

  const avisos = [...(rango.avisos ?? []), ...u.avisos, ...avisoUbicacionesSinLeer(r.conError)];
  if (total > ULTIMOS_ACCESOS) {
    avisos.push(
      `Hay ${total} registros: aquí van los ${ULTIMOS_ACCESOS} más recientes.${conExcel ? ' Si quiere verlos todos, ofrécele enviárselos en Excel con enviar_excel_accesos.' : ' El listado completo está en el panel (Control de Acceso).'}`
    );
  }
  if (total === 0 && args.zona) {
    avisos.push(
      'Ningún registro con esa zona: la zona tiene que escribirse como en el panel; compruébala con el cliente.'
    );
  }
  return ok(
    {
      desde: rango.dateFrom ?? null,
      hasta: rango.dateTo ?? null,
      total,
      entradas,
      salidas: total - entradas,
      ultimos,
    },
    { avisos }
  );
}

/** Control de Acceso: entradas, salidas y quién está dentro. */
export function accessReads({ gateway, offerFiles }: ReadEnv): ReadCapability[] {
  return [
    defineRead({
      name: 'consultar_accesos',
      description: accesosDesc,
      params: accesosParamSchema,
      call: async (ctx, args) => consultarAccesos(gateway, ctx, args, { conExcel: offerFiles }),
    }),
  ];
}
