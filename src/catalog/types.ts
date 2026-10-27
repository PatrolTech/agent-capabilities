import type { ActionDefinition } from '../actions/types.js';
import type { ReadCapability } from '../reads/types.js';

/** Quién consume el catálogo: el bot de WhatsApp/Telegram o el servidor MCP. */
export type Channel = 'bot' | 'mcp';

/** Metadatos de UNA capacidad (lectura o acción): lo que decide dónde se ofrece y cómo se describe. */
export interface CapabilityMeta {
  /** Identificador estable, en inglés y snake_case con espacio de nombres: `rounds.get_status`. */
  id: string;
  /** Nombre de la lectura (`consultar_estado_rondas`) o de la acción (`create_route`). */
  capability: string;
  kind: 'read' | 'action';
  /** Canales que la ofrecen. */
  channels: Channel[];
  /** `public` = documentable de cara a clientes y agentes externos; `internal` = solo el bot. */
  visibility: 'public' | 'internal';
  status: 'ga' | 'beta' | 'off';
  readOnly: boolean;
  /** Borra, archiva, quita acceso, cambia un rol o toca el antifraude/posición: pide cuidado extra. */
  destructive: boolean;
  /**
   * `user` = solo afecta al usuario que la usa, en todas sus organizaciones (p. ej. sus avisos):
   * el consumidor no debe pedirle que elija organización. `organization` = actúa sobre una.
   */
  scope: 'organization' | 'user';
  title: { es: string; en: string };
  summary: { es: string; en: string };
  /**
   * Qué devuelve una lectura y cómo leer sus campos (zona horaria, marcas como `alMenos`, lo oculto
   * por la retención de datos…), en inglés: lo que el bot dice en su `description` en español, para
   * los canales que describen con `meta`. Obligatorio en toda lectura `mcp` (lo vigila el test del
   * catálogo); sin nombres de plan, canal ni herramientas del bot.
   */
  returns?: { en: string };
  /** Funciones de `@patroltech/sdk-api` (operationId del contrato público) a las que acaba llamando. */
  operationIds: string[];
  owner: string;
  /** Última vez (YYYY-MM-DD) que alguien comprobó que la entrada sigue siendo cierta. */
  verifiedAt: string;
}

export interface CatalogRead {
  meta: CapabilityMeta;
  read: ReadCapability;
}

export interface CatalogAction {
  meta: CapabilityMeta;
  action: ActionDefinition;
}

/** Lo que `buildCatalog` ofrece a un canal. */
export interface Catalog {
  reads: CatalogRead[];
  actions: CatalogAction[];
}
