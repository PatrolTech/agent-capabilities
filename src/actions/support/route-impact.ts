import {
  aplicarCambios,
  efectoDeQuitar,
  type EfectoDeQuitar,
  type RutaConCheckpoints,
} from '../../domain/route-checkpoints.js';
import type {
  ArchivedCheckpointRoute,
  ListaTruncable,
  PatrolTechGateway,
  RouteDetails,
  RouteRef,
} from '../../gateway/index.js';
import type { Logger } from '../../ports/Logger.js';
import type { ActionPrepareContext } from '../types.js';
import { turnoDe } from './turno.js';

/**
 * Qué les pasa a las rutas al quitarles checkpoints (quitar de una ruta,
 * archivar), teniendo en cuenta lo que ya proponen las anteriores del lote. Lo
 * usan las acciones de rutas y las de checkpoints; vive aquí para que ninguna
 * de las dos tenga que importar a la otra.
 */

/** Lecturas de detalle de rutas a la vez, como mucho: archivar no dispara una ráfaga contra el backend. */
const LECTURAS_A_LA_VEZ = 5;

/** Las rutas de la organización (una sola lectura por turno). */
export function leerRutas(
  gateway: PatrolTechGateway,
  ctx: ActionPrepareContext
): Promise<ListaTruncable<RouteRef>> {
  const lectura = () => gateway.listRoutes(ctx.org.orgId, ctx.token);
  return turnoDe(ctx).leer(`rutas:${ctx.org.orgId}`, lectura);
}

/** El detalle de una ruta (una sola lectura por turno). */
export function leerRuta(
  gateway: PatrolTechGateway,
  ctx: ActionPrepareContext,
  rutaId: string
): Promise<RouteDetails | null> {
  const lectura = () => gateway.getRouteDetails(rutaId, ctx.token);
  return turnoDe(ctx).leer(`ruta:${rutaId}`, lectura);
}

/** La ruta tal como la dejan las propuestas anteriores del lote. */
export function rutaEnElLote(ctx: ActionPrepareContext, detalle: RouteDetails): RutaConCheckpoints {
  return aplicarCambios(detalle, turnoDe(ctx).cambiosEnRuta(detalle.id));
}

/** Quitar `checkpointId` de la ruta, después de lo que ya quita o añade el lote. */
export function efectoEnElLote(
  ctx: ActionPrepareContext,
  detalle: RouteDetails,
  checkpointId: string
): EfectoDeQuitar {
  return efectoDeQuitar(rutaEnElLote(ctx, detalle), new Set([checkpointId]));
}

/** `fn` sobre cada elemento, con `limite` en vuelo como mucho; el resultado, en el orden de `items`. */
async function enParalelo<T, R>(
  items: readonly T[],
  limite: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let siguiente = 0;
  const trabajador = async (): Promise<void> => {
    while (siguiente < items.length) {
      const i = siguiente++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return out;
}

/**
 * Rutas en las que está el checkpoint (tras los cambios previos del lote) y si
 * se quedarían vacías y se desactivarían sin él, para avisar ANTES de confirmar.
 * Mismo vocabulario que devuelve el backend al archivar (`ArchivedCheckpointRoute`).
 * Solo se leen las rutas de su ubicación (una ruta solo lleva checkpoints de la
 * suya) y las de ubicación desconocida. Undefined si no se puede saber con
 * certeza (lista truncada, una ruta sin detalle o fallo al leer): el resumen usa entonces el aviso genérico.
 */
export async function rutasDelCheckpoint(
  gateway: PatrolTechGateway,
  logger: Logger,
  ctx: ActionPrepareContext,
  checkpoint: { id: string; locationId: string }
): Promise<ArchivedCheckpointRoute[] | undefined> {
  try {
    const { items, truncado } = await leerRutas(gateway, ctx);
    if (truncado) return undefined;
    const suyas = items.filter((r) => !r.locationId || r.locationId === checkpoint.locationId);
    const detalles = await enParalelo(suyas, LECTURAS_A_LA_VEZ, (r) =>
      leerRuta(gateway, ctx, r.id)
    );
    // Una ruta de la lista que no se puede leer puede llevar el checkpoint: no se sabe, aviso genérico.
    if (detalles.some((d) => d === null)) return undefined;
    return detalles.flatMap((d) => {
      if (!d || !rutaEnElLote(ctx, d).checkpoints.some((c) => c.checkpointId === checkpoint.id)) {
        return [];
      }
      const efecto = efectoEnElLote(ctx, d, checkpoint.id);
      return [{ id: d.id, name: d.name, leftEmpty: efecto.vacia, deactivated: efecto.seDesactiva }];
    });
  } catch (err) {
    logger.warn('bot_action.archive_checkpoint_routes_unknown', {
      checkpointId: checkpoint.id,
      err,
    });
    return undefined;
  }
}
