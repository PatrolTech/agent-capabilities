/**
 * Los enlaces de PatrolTech que aparecen en los textos al cliente y en los
 * enlaces que se generan. Los inyecta el consumidor UNA vez (dependencias del
 * catálogo); por defecto, los de producción.
 */
export interface PatrolTechUrls {
  /** App de vigilantes: base de `/<orgId>` y `/<orgId>/<identifier>`. */
  app: string;
  /** Panel de clientes: políticas, cobros extra, acceso de usuarios invitados. */
  dashboard: string;
  /** Página Licencia del panel: planes, vuelta desde Stripe y del portal de suscripción. */
  license: string;
}

/** Los de producción. */
export const DEFAULT_URLS: Readonly<PatrolTechUrls> = Object.freeze({
  app: 'https://app.patroltech.online',
  dashboard: 'https://dashboard.patroltech.online',
  license: 'https://dashboard.patroltech.online/license',
});

/**
 * Completa los enlaces que no da el consumidor con los de producción. Sin
 * `license`, es la página Licencia de SU panel (`<dashboard>/license`): así un
 * panel de staging no deriva a la Licencia de producción.
 */
export function resolveUrls(urls: Partial<PatrolTechUrls> = {}): PatrolTechUrls {
  const dashboard = urls.dashboard ?? DEFAULT_URLS.dashboard;
  return {
    app: urls.app ?? DEFAULT_URLS.app,
    dashboard,
    license: urls.license ?? `${dashboard}/license`,
  };
}

/**
 * Política de textos al cliente que comparten lecturas, acciones y errores:
 * - `urls`: los enlaces que se citan;
 * - `upsell`: true (por defecto, el bot) = los límites se explican con el plan y
 *   cómo ampliarlo en Licencia; false (MCP) = solo los números, sin nombres de
 *   plan, sin «mejorar el plan» y sin enlaces a Licencia.
 */
export interface TextPolicyOptions {
  urls?: Partial<PatrolTechUrls>;
  upsell?: boolean;
}
