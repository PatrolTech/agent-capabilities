/**
 * Lo que `isTruncated` mira de una página de lista del backend (`results` +
 * `count`/`totalPages`): lo cumplen las respuestas generadas por el SDK.
 */
export interface ListPage {
  results: readonly unknown[];
  count?: number | null;
  totalPages?: number | null;
}

/**
 * ¿La lista viene capada? El backend informa `count`/`totalPages`; sin mirarlos
 * se presentaba una página como si fuera el total.
 */
export function isTruncated(body: ListPage, returned: number): boolean {
  if (typeof body.count === 'number' && body.count > returned) return true;
  if (typeof body.totalPages === 'number' && body.totalPages > 1) return true;
  return body.results.length > returned;
}
