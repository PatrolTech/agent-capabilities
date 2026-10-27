import { resolveUrls, type PatrolTechUrls, type TextPolicyOptions } from './domain/urls.js';
import type { PatrolTechGateway } from './gateway/PatrolTechGateway.js';
import { noopLogger, type Logger } from './ports/Logger.js';

/**
 * Dependencias comunes de `readCapabilities`, `actionCatalog` y `buildCatalog`:
 * se dan UNA vez al construir el catálogo. Nada de una sesión concreta (token,
 * organización, ficheros) va aquí: eso viaja en el contexto de cada llamada.
 */
export interface CapabilityDeps extends TextPolicyOptions {
  gateway: PatrolTechGateway;
  logger?: Logger;
}

/** Las dependencias ya con sus valores por defecto, tal como las reciben las áreas. */
export interface CapabilityEnv {
  gateway: PatrolTechGateway;
  logger: Logger;
  urls: PatrolTechUrls;
  /** Ver `TextPolicyOptions.upsell`: true salvo que el consumidor (o el canal MCP) diga lo contrario. */
  upsell: boolean;
}

/** Completa las dependencias: logger nulo, enlaces de producción y los textos del bot (`upsell: true`). */
export function capabilityEnv(deps: CapabilityDeps): CapabilityEnv {
  return {
    gateway: deps.gateway,
    logger: deps.logger ?? noopLogger,
    urls: resolveUrls(deps.urls),
    upsell: deps.upsell ?? true,
  };
}
