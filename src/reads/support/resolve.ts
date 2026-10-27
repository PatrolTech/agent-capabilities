import { resolveByName } from '../../domain/resolve-by-name.js';
import { fail, type ToolResult } from '../../domain/tool-result.js';
import type { CheckpointRef, RouteRef } from '../../gateway/index.js';
import { failAmbigua, failNoEncontrado, MAX_OPCIONES } from './results.js';

/** Cómo se nombra cada tipo de elemento en los fallos: [singular, plural]. */
export const VIGILANTE: [string, string] = ['vigilante', 'vigilantes'];
export const CHECKPOINT: [string, string] = ['checkpoint', 'checkpoints'];
export const UBICACION: [string, string] = ['ubicación', 'ubicaciones'];
const RUTA: [string, string] = ['ruta', 'rutas'];

/** Dos checkpoints pueden llamarse igual en ubicaciones distintas: la opción lleva la ubicación. */
export const etiquetaCheckpoint = (c: CheckpointRef): string => `${c.name} (${c.locationName})`;

/** Resuelve un nombre dicho por el usuario contra una lista, con el mismo contrato de ambigua / no encontrado. */
export function resolveNamed<T>(
  valor: string,
  items: readonly T[],
  nameOf: (item: T) => string,
  [singular, plural]: [string, string],
  etiqueta: (item: T) => string = nameOf
): { item: T } | ToolResult<never> {
  const match = resolveByName(valor, items, nameOf);
  if (match.kind === 'found') return { item: match.item };
  if (match.kind === 'ambiguous') {
    return failAmbigua(valor, plural, match.matches.slice(0, MAX_OPCIONES).map(etiqueta));
  }
  return failNoEncontrado(singular, items.slice(0, MAX_OPCIONES).map(etiqueta));
}

/** Sin nombre de ruta: la única activa (o la única) vale; con varias, se pregunta. */
export function resolveRuta(
  ruta: string | undefined,
  rutas: RouteRef[]
): { item: RouteRef } | ToolResult<never> {
  if (rutas.length === 0) return fail('La organización no tiene ninguna ruta creada.');
  if (ruta) return resolveNamed(ruta, rutas, (r) => r.name, RUTA);
  const activas = rutas.filter((r) => r.isActive);
  const candidatas = activas.length > 0 ? activas : rutas;
  if (candidatas.length === 1) return { item: candidatas[0] };
  return fail(
    'ruta no indicada: hay varias, pregunta al usuario cuál de estas quiere',
    candidatas.map((r) => r.name)
  );
}
