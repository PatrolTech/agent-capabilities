import type { ToolResult } from '../../domain/tool-result.js';
import type { PatrolTechGateway, RecentScan, ScanQuery } from '../../gateway/index.js';
import { isFail } from './results.js';
import { CHECKPOINT, etiquetaCheckpoint, resolveNamed, UBICACION, VIGILANTE } from './resolve.js';

// El backend da como mucho 100 filas por página (escaneos y registros de acceso).
export const TAM_PAGINA = 100;
// Tope de 2.000 filas (20 páginas) para no colgar al consumidor ni mandar
// ficheros enormes por el chat; más allá, que acote el periodo o los filtros, o
// exporte desde el panel.
export const MAX_FILAS = 2000;
export const DIA_MS = 86_400_000;

/**
 * Los escaneos que casan con `query`, de 100 en 100 y del más reciente al más
 * antiguo, hasta `maxFilas` o hasta que `seguir` (tras cada página) diga que ya
 * basta. `hayMas`: quedaron escaneos sin leer.
 */
export async function paginarEscaneos(
  gateway: PatrolTechGateway,
  orgId: string,
  token: string,
  query: ScanQuery,
  {
    maxFilas = MAX_FILAS,
    seguir = () => true,
  }: { maxFilas?: number; seguir?: (pagina: RecentScan[]) => boolean } = {}
): Promise<{ escaneos: RecentScan[]; hayMas: boolean }> {
  const escaneos: RecentScan[] = [];
  let hayMas = true;
  for (let page = 1; hayMas && escaneos.length < maxFilas; page++) {
    const { items, total } = await gateway.getRecentScans(orgId, token, {
      ...query,
      limit: TAM_PAGINA,
      page,
    });
    escaneos.push(...items);
    hayMas = items.length === TAM_PAGINA && (total === undefined || escaneos.length < total);
    if (!seguir(items)) break;
  }
  return { escaneos, hayMas };
}

/** Filtros de escaneos tal como los dice el usuario (por nombre). */
export interface FiltrosEscaneos {
  vigilante?: string;
  checkpoint?: string;
  ubicacion?: string;
  solo_sospechosos?: boolean;
  solo_no_validos?: boolean;
}

/**
 * Filtros de escaneos dichos por su nombre → ids del backend (que no filtra por
 * nombre). Lo comparten consultar_ultimos_scans y enviar_excel_escaneos.
 */
export async function resolverFiltrosEscaneos(
  gateway: PatrolTechGateway,
  orgId: string,
  token: string,
  args: FiltrosEscaneos
): Promise<ScanQuery | ToolResult<never>> {
  const filtros: ScanQuery = {
    soloSospechosos: args.solo_sospechosos,
    soloNoValidos: args.solo_no_validos,
  };
  if (args.vigilante) {
    const vigilantes = await gateway.listPatrollers(orgId, token);
    const r = resolveNamed(args.vigilante, vigilantes.items, (p) => p.name, VIGILANTE);
    if (isFail(r)) return r;
    filtros.patrollerId = r.item.id;
  }
  if (args.ubicacion) {
    const ubicaciones = await gateway.listLocations(orgId, token);
    const r = resolveNamed(args.ubicacion, ubicaciones, (l) => l.name, UBICACION);
    if (isFail(r)) return r;
    filtros.locationId = r.item.id;
  }
  if (args.checkpoint) {
    const { items } = await gateway.listCheckpoints(orgId, token);
    const candidatos = filtros.locationId
      ? items.filter((c) => c.locationId === filtros.locationId)
      : items;
    const r = resolveNamed(
      args.checkpoint,
      candidatos,
      (c) => c.name,
      CHECKPOINT,
      etiquetaCheckpoint
    );
    if (isFail(r)) return r;
    filtros.checkpointId = r.item.id;
  }
  return filtros;
}
