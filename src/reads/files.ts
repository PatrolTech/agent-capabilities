import { z } from 'zod';
import { accessLogsCsv } from '../domain/access-logs-csv.js';
import { resolveDateRange } from '../domain/date-range.js';
import { checkpointQrImage } from '../domain/qr-image.js';
import { scansCsv } from '../domain/scans-csv.js';
import { fail, ok, type ToolResult } from '../domain/tool-result.js';
import type {
  AccessLogEntry,
  CheckpointRef,
  LocationRef,
  PatrolTechGateway,
} from '../gateway/index.js';
import type { FileSink } from '../ports/FileSink.js';
import {
  avisoUbicacionesSinLeer,
  porUbicacion,
  TIPO_PARAM,
  ubicacionesAccesos,
} from './support/access-locations.js';
import { enviarCsv, validarPeriodoExcel } from './support/excel.js';
import { accesosParamSchema, fechaSchema, scansFiltrosSchema } from './support/params.js';
import { CHECKPOINT, etiquetaCheckpoint, resolveNamed, UBICACION } from './support/resolve.js';
import { isFail } from './support/results.js';
import {
  MAX_FILAS,
  TAM_PAGINA,
  paginarEscaneos,
  resolverFiltrosEscaneos,
} from './support/scans.js';
import { defineRead, type CapabilityContext, type ReadCapability, type ReadEnv } from './types.js';

const enviarQrDesc =
  'Envía al cliente, por este chat, la imagen del QR de un checkpoint existente (con su nombre y código al pie) para imprimirlo. Úsala cuando pida el QR o el código de un checkpoint. Si el nombre es ambiguo o hay varias ubicaciones, pasa `ubicacion`. Solo un Editor o Admin de esa ubicación puede ver el código: si no lo tiene, explícale que se lo pida a un editor. Si devuelve `enviado: true`, la imagen YA le ha llegado: no la describas ni repitas el código, confirma en una frase. Si es de código manual, devuelve el código para dárselo en texto. Trae también el `identificador` (columna «Identificador» del panel) si lo piden.';
const excelDesc =
  'Envía al cliente, por este chat, un fichero con los escaneos de un periodo (máximo 31 días) para abrirlo con Excel: fecha y hora, vigilante, checkpoint, ubicación, validación, sospecha, distancia GPS, dispositivo y batería. Úsala cuando pida los escaneos «en Excel», «en un fichero» o «para descargar», o cuando el Excel del panel le dé problemas. Admite los mismos filtros que consultar_ultimos_scans. Para un mes más largo que 31 días o «todo el año», pídelo por meses. Si devuelve `enviado: true`, el fichero YA le ha llegado: no repitas los datos, confírmalo en una frase.';
const excelAccesosDesc =
  'Envía al cliente, por este chat, un fichero para Excel con los registros del Control de Acceso de un periodo (máximo 31 días): fecha y hora, tipo, ubicación, zona, persona autorizada e identificador, visitante con su documento y empresa, destino y notas (lo mismo que la tabla del panel). Úsala cuando pida los accesos «en Excel» o cuando consultar_accesos tenga muchos registros. Si devuelve `enviado: true`, el fichero YA le ha llegado: confírmalo en una frase sin repetir los datos.';

const excelParamSchema = {
  desde: fechaSchema('Primer día del periodo'),
  hasta: fechaSchema('Último día del periodo (inclusive; máximo 31 días después de «desde»)'),
  vigilante: scansFiltrosSchema.vigilante,
  checkpoint: scansFiltrosSchema.checkpoint,
  ubicacion: scansFiltrosSchema.ubicacion,
  solo_sospechosos: scansFiltrosSchema.solo_sospechosos,
  solo_no_validos: scansFiltrosSchema.solo_no_validos,
};
const excelAccesosParamSchema = {
  desde: fechaSchema('Primer día del periodo'),
  hasta: fechaSchema('Último día del periodo (inclusive; máximo 31 días después de «desde»)'),
  ubicacion: accesosParamSchema.ubicacion,
  zona: accesosParamSchema.zona,
  tipo: accesosParamSchema.tipo,
};

/**
 * El código solo viene si el usuario es EDITOR de la ubicación del checkpoint;
 * sin él no hay QR que generar (el mismo criterio que el panel: un Viewer no
 * imprime QR).
 */
async function enviarQr(cp: CheckpointRef, files: FileSink): Promise<ToolResult<unknown>> {
  if (cp.metodo !== 'qr_static' && cp.metodo !== 'manual_code') {
    return fail(
      `«${cp.name}» no se marca con QR ni con código manual (método: ${cp.metodo ?? 'ninguno'}), así que no tiene QR que enviar.`
    );
  }
  if (!cp.codigo) {
    return fail(
      `Tu usuario no puede ver el código de «${cp.name}»: solo lo ve un Editor o Admin de la ubicación «${cp.locationName}». Pídeselo a un editor, que puede imprimirlo en Checkpoints → Imprimir QR.`
    );
  }
  const identificador = cp.identificador ? { identificador: cp.identificador } : {};
  if (cp.metodo === 'manual_code') {
    return ok(
      {
        enviado: false,
        nombre: cp.name,
        metodo: 'codigo_manual',
        codigo: cp.codigo,
        ...identificador,
      },
      {
        avisos: [
          'Este checkpoint es de código manual, no de QR: dale el código en texto; el vigilante lo teclea en la app.',
        ],
      }
    );
  }
  const { png, caption } = await checkpointQrImage({ code: cp.codigo, name: cp.name });
  await files.sendImage({ png, caption });
  return ok({ enviado: true, nombre: cp.name, codigo: cp.codigo, ...identificador });
}

/**
 * Los escaneos del periodo en un CSV para Excel, enviado como documento. La
 * lista de escaneos no trae la ubicación: se deduce del nombre del checkpoint
 * (si ese nombre está en varias ubicaciones, se ponen todas).
 */
async function enviarExcelEscaneos(
  gateway: PatrolTechGateway,
  files: FileSink,
  { org, token, tz }: CapabilityContext,
  args: z.infer<z.ZodObject<typeof excelParamSchema>>
): Promise<ToolResult<unknown>> {
  const periodoMalo = validarPeriodoExcel(args.desde, args.hasta);
  if (periodoMalo) return periodoMalo;

  const orgId = org.orgId;
  const filtros = await resolverFiltrosEscaneos(gateway, orgId, token, args);
  if (isFail(filtros)) return filtros;
  const { dateFrom, dateTo } = resolveDateRange(undefined, args.desde, args.hasta, new Date(), tz);

  const { escaneos, hayMas } = await paginarEscaneos(gateway, orgId, token, {
    ...filtros,
    dateFrom,
    dateTo,
  });
  const periodo = { desde: args.desde, hasta: args.hasta };
  if (escaneos.length === 0) {
    return ok(
      { enviado: false, filas: 0, periodo },
      {
        avisos: [
          'No hay escaneos con esos filtros en ese periodo: no se ha enviado ningún fichero.',
        ],
      }
    );
  }

  const ubicaciones = new Map<string, Set<string>>();
  for (const c of (await gateway.listCheckpoints(orgId, token)).items) {
    ubicaciones.set(c.name, (ubicaciones.get(c.name) ?? new Set()).add(c.locationName));
  }
  const bytes = scansCsv(escaneos, {
    tz,
    ubicacionDe: (s) => [...(ubicaciones.get(s.checkpointName ?? '') ?? [])].join(' / '),
  });
  await enviarCsv(
    files,
    bytes,
    `escaneos_${args.desde}_${args.hasta}.csv`,
    `Escaneos del ${args.desde} al ${args.hasta} (${escaneos.length} filas). Se abre con Excel.`
  );
  const avisos = hayMas
    ? [
        `El fichero tiene los ${MAX_FILAS} escaneos más recientes del periodo: hay más. Díselo y ofrécele acotar las fechas o los filtros.`,
      ]
    : [];
  return ok({ enviado: true, filas: escaneos.length, periodo }, { truncado: hayMas, avisos });
}

async function enviarExcelAccesos(
  gateway: PatrolTechGateway,
  files: FileSink,
  { org, token, tz }: CapabilityContext,
  args: z.infer<z.ZodObject<typeof excelAccesosParamSchema>>
): Promise<ToolResult<unknown>> {
  const periodoMalo = validarPeriodoExcel(args.desde, args.hasta);
  if (periodoMalo) return periodoMalo;
  const u = await ubicacionesAccesos(gateway, org.orgId, token, args.ubicacion);
  if (isFail(u)) return u;
  const { dateFrom, dateTo } = resolveDateRange(undefined, args.desde, args.hasta, new Date(), tz);
  const tipo = args.tipo ? TIPO_PARAM[args.tipo] : undefined;
  const query = { zona: args.zona, tipo, desde: dateFrom, hasta: dateTo };

  // Mismo tope que el Excel de escaneos, repartido entre las ubicaciones en orden.
  let presupuesto = MAX_FILAS;
  // Objeto y no `let`: se marca dentro del recorrido de ubicaciones.
  const corte = { hayMas: false };
  const r = await porUbicacion(u.ubicaciones, async (l) => {
    const filas: AccessLogEntry[] = [];
    if (presupuesto <= 0) {
      // Tope ya lleno: solo hay «más» si esta ubicación tiene alguno (con justo 2000 se avisaba en falso).
      const resto = await gateway.listAccessLogs(
        { ...query, locationId: l.id, page: 1, limit: 1 },
        token
      );
      if (resto.total > 0) corte.hayMas = true;
      return filas;
    }
    for (let page = 1; ; page++) {
      const { items, total } = await gateway.listAccessLogs(
        { ...query, locationId: l.id, page, limit: TAM_PAGINA },
        token
      );
      const tomadas = items.slice(0, presupuesto);
      filas.push(...tomadas);
      presupuesto -= tomadas.length;
      const quedan =
        tomadas.length < items.length || (items.length === TAM_PAGINA && page * TAM_PAGINA < total);
      if (!quedan) return filas;
      if (presupuesto <= 0) {
        corte.hayMas = true;
        return filas;
      }
    }
  });
  if (isFail(r)) return r;

  const registros = r.resultados
    .flatMap((x) => x.valor)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const periodo = { desde: args.desde, hasta: args.hasta };
  const avisos = [...u.avisos, ...avisoUbicacionesSinLeer(r.conError)];
  if (registros.length === 0) {
    return ok(
      { enviado: false, filas: 0, periodo },
      {
        avisos: [
          ...avisos,
          'No hay registros de acceso con esos filtros en ese periodo: no se ha enviado ningún fichero.',
        ],
      }
    );
  }
  const nombres = new Map(u.ubicaciones.map((l) => [l.id, l.name]));
  const bytes = accessLogsCsv(registros, {
    tz,
    ubicacionDe: (a) => nombres.get(a.locationId) ?? '',
  });
  await enviarCsv(
    files,
    bytes,
    `accesos_${args.desde}_${args.hasta}.csv`,
    `Accesos del ${args.desde} al ${args.hasta} (${registros.length} filas). Se abre con Excel.`
  );
  if (corte.hayMas) {
    avisos.push(
      `El fichero tiene ${MAX_FILAS} registros y hay más: díselo y ofrécele acotar las fechas, la ubicación o la zona.`
    );
  }
  return ok(
    { enviado: true, filas: registros.length, periodo },
    { truncado: corte.hayMas, avisos }
  );
}

/** Lo que se le dice al modelo si la llamada no trae dónde dejar el fichero. */
export const SIN_FICHEROS =
  'No puedo enviar ficheros en esta conversación: no se ha enviado nada. Dale los datos en texto o remítele al panel.';

/**
 * Ficheros al cliente (QR y Excel): solo existen con `offerFiles`, y cada
 * llamada los deja en SU `ctx.files`; sin él, falla sin consultar nada.
 */
export function fileReads({ gateway }: ReadEnv): ReadCapability[] {
  return [
    defineRead({
      name: 'enviar_qr_checkpoint',
      description: enviarQrDesc,
      params: {
        checkpoint: z.string().min(1).describe('Nombre del checkpoint'),
        ubicacion: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Nombre de la ubicación, si hay varios checkpoints con ese nombre. OMÍTELO si no hace falta.'
          ),
      },
      call: async ({ org, token, files }, { checkpoint, ubicacion }) => {
        if (!files) return fail(SIN_FICHEROS);
        const { items } = await gateway.listCheckpoints(org.orgId, token);
        let candidatos = items;
        if (ubicacion) {
          const ubicaciones = [
            ...new Map<string, LocationRef>(
              items.map((c) => [c.locationId, { id: c.locationId, name: c.locationName }])
            ).values(),
          ];
          const u = resolveNamed(ubicacion, ubicaciones, (l) => l.name, UBICACION);
          if (isFail(u)) return u;
          candidatos = items.filter((c) => c.locationId === u.item.id);
        }
        const r = resolveNamed(
          checkpoint,
          candidatos,
          (c) => c.name,
          CHECKPOINT,
          etiquetaCheckpoint
        );
        if (isFail(r)) return r;
        return enviarQr(r.item, files);
      },
    }),
    defineRead({
      name: 'enviar_excel_escaneos',
      description: excelDesc,
      params: excelParamSchema,
      call: async (ctx, args) =>
        ctx.files ? enviarExcelEscaneos(gateway, ctx.files, ctx, args) : fail(SIN_FICHEROS),
    }),
    defineRead({
      name: 'enviar_excel_accesos',
      description: excelAccesosDesc,
      params: excelAccesosParamSchema,
      call: async (ctx, args) =>
        ctx.files ? enviarExcelAccesos(gateway, ctx.files, ctx, args) : fail(SIN_FICHEROS),
    }),
  ];
}
