import { actionCatalog } from '../actions/index.js';
import { readCapabilities } from '../reads/index.js';
import type { ReadDeps } from '../reads/types.js';
import { ACTION_ENTRIES, READ_ENTRIES } from './entries.js';
import type { CapabilityMeta, Catalog, Channel } from './types.js';

/**
 * Dependencias del catálogo: las comunes (`gateway`, `logger`, `urls`) que
 * reciben a la vez lecturas y acciones, más `offerFiles` de las lecturas.
 */
export type CatalogDeps = ReadDeps;

function indexByCapability(entries: readonly CapabilityMeta[]): Map<string, CapabilityMeta> {
  return new Map(entries.map((m) => [m.capability, m]));
}

/** ¿La ofrece este canal? Una entrada `off` no se ofrece en ninguno. */
const offeredTo = (meta: CapabilityMeta, channel: Channel): boolean =>
  meta.status !== 'off' && meta.channels.includes(channel);

/**
 * El catálogo único de capacidades para un canal: cada lectura y cada acción
 * junto a sus metadatos. Una capacidad sin entrada es un error de programación
 * (se perdería en silencio de todos los canales), no un caso a tolerar.
 *
 * En `mcp` los textos van SIEMPRE sin upsell (`upsell: false`), digan lo que
 * digan las dependencias: ni nombres de plan ni «mejorar el plan».
 */
export function buildCatalog(catalogDeps: CatalogDeps, opts: { channel: Channel }): Catalog {
  const deps = opts.channel === 'mcp' ? { ...catalogDeps, upsell: false } : catalogDeps;
  const readMetas = indexByCapability(READ_ENTRIES);
  const actionMetas = indexByCapability(ACTION_ENTRIES);

  const reads = readCapabilities(deps).map((read) => {
    const meta = readMetas.get(read.name);
    if (!meta) throw new Error(`Lectura sin entrada en el catálogo: ${read.name}`);
    return { meta, read };
  });
  const actions = actionCatalog(deps).map((action) => {
    const meta = actionMetas.get(action.nombre);
    if (!meta) throw new Error(`Acción sin entrada en el catálogo: ${action.nombre}`);
    return { meta, action };
  });

  return {
    reads: reads.filter(({ meta }) => offeredTo(meta, opts.channel)),
    actions: actions.filter(({ meta }) => offeredTo(meta, opts.channel)),
  };
}
