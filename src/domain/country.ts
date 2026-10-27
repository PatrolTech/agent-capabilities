const REGIONES = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

/**
 * País ISO-2 que da el cliente (o el modelo en su nombre), validado; null si no es un código real.
 * Las capacidades no deciden la moneda: solo le pasan al backend el país, como el selector de
 * planes del panel. (El país por el teléfono lo deduce el consumidor y llega en el contexto.)
 */
export function normalizeCountry(input: string | null | undefined): string | null {
  const code = input?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && REGIONES.of(code) ? code : null;
}

/** Lo que hay que hacer cuando falta el país: preguntárselo al cliente. */
export const FALTA_PAIS =
  'Falta el país del cliente, que el sistema necesita para darle los precios y cobrarle en su moneda. Pregúntale en qué país está su empresa (una sola pregunta) y vuelve a llamar a esta herramienta con `pais` = su código ISO-2 (p. ej. MX, ES, AR). No supongas el país.';
