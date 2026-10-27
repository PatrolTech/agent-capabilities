import { resolveByName } from '../../domain/resolve-by-name.js';
import type {
  CheckpointRef,
  PatrolTechGateway,
  RouteDetails,
  RouteRef,
} from '../../gateway/index.js';
import type { ActionPrepareContext } from '../types.js';
import { leerRuta, leerRutas } from './route-impact.js';
import { elegir } from './shared.js';

/**
 * Un checkpoint de la ubicación de una ruta, por nombre. Solo se ofrecen los no
 * archivados (`listCheckpoints`): uno archivado no admite escaneos y el backend
 * lo rechaza en una ruta (400 `CHECKPOINT_ARCHIVED`). Si el nombre es el de uno
 * archivado de esa ubicación, se dice así en vez de «no lo encuentro».
 */
export async function elegirCheckpointParaRuta(
  gateway: PatrolTechGateway,
  ctx: ActionPrepareContext,
  nombre: string,
  candidatos: readonly CheckpointRef[],
  locationId: string | null | undefined,
  entre: string
): Promise<{ item: CheckpointRef } | { error: string }> {
  const c = elegir(nombre, candidatos, (x) => x.name, entre);
  if (
    !('error' in c) ||
    !locationId ||
    resolveByName(nombre, candidatos, (x) => x.name).kind !== 'none'
  )
    return c;
  const archivados = await gateway
    .listArchivedCheckpoints(ctx.org.orgId, ctx.token)
    .catch(() => null);
  const a = resolveByName(
    nombre,
    archivados?.items.filter((x) => x.locationId === locationId) ?? [],
    (x) => x.name
  );
  if (a.kind !== 'found') return c;
  return {
    error:
      `El checkpoint «${a.item.name}» está archivado: un checkpoint archivado no se puede usar en rutas. ` +
      'Díselo al usuario; si vuelve a estar en servicio, primero hay que desarchivarlo.',
  };
}

/** Una ruta de la organización por su nombre. */
export async function elegirRuta(
  gateway: PatrolTechGateway,
  ctx: ActionPrepareContext,
  nombre: string
): Promise<{ item: RouteRef } | { error: string }> {
  const rutas = (await leerRutas(gateway, ctx)).items;
  if (rutas.length === 0) return { error: 'La organización no tiene ninguna ruta creada.' };
  return elegir(nombre, rutas, (r) => r.name, 'las rutas');
}

/** Íd., con sus checkpoints y horarios. */
export async function elegirRutaConDetalle(
  gateway: PatrolTechGateway,
  ctx: ActionPrepareContext,
  nombre: string
): Promise<{ ruta: RouteRef; detalle: RouteDetails } | { error: string }> {
  const r = await elegirRuta(gateway, ctx, nombre);
  if ('error' in r) return r;
  const detalle = await leerRuta(gateway, ctx, r.item.id);
  return detalle
    ? { ruta: r.item, detalle }
    : { error: `No he podido leer la ruta «${r.item.name}».` };
}
