/**
 * Forma comparable de un nombre: sin tildes, sin mayúsculas y con los espacios
 * colapsados. Por WhatsApp escriben «almacen norte» para «Almacén Norte».
 */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Resolución de un nombre dicho por el usuario (organización, vigilante, ruta)
 * contra la lista de elementos a los que tiene acceso.
 *
 * Reglas, en este orden: cadena vacía = NO resuelto; coincidencia exacta del
 * nombre (sin distinguir mayúsculas, tildes ni espacios repetidos: `normalizeName`);
 * identificador exacto (cuando el llamador sabe mapearlo, p. ej. el id que
 * devuelve un botón de WhatsApp); índice numérico
 * 1-based ("2"); y por último substring. Un substring que casa con más de un
 * elemento es AMBIGUO y se devuelve como tal: coger el primero en silencio hacía
 * que "Vigilancia" con Madrid y Barcelona respondiera con los datos de Madrid
 * sin que nadie se enterase.
 */
export type NameMatch<T> =
  { kind: 'found'; item: T } | { kind: 'none' } | { kind: 'ambiguous'; matches: T[] };

export function resolveByName<T>(
  input: string,
  items: readonly T[],
  nameOf: (item: T) => string,
  opts: { byIndex?: boolean; idOf?: (item: T) => string } = {}
): NameMatch<T> {
  const trimmed = input.trim();
  // Vacío no resuelve: `''.includes('')` es true y devolvía SIEMPRE el primero.
  if (!trimmed) return { kind: 'none' };
  const lower = normalizeName(trimmed);
  const nombre = (item: T): string => normalizeName(nameOf(item));

  const exact = items.filter((item) => nombre(item) === lower);
  if (exact.length === 1) return { kind: 'found', item: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', matches: exact };

  if (opts.idOf) {
    const byId = items.filter((item) => opts.idOf!(item).toLowerCase() === trimmed.toLowerCase());
    if (byId.length === 1) return { kind: 'found', item: byId[0] };
  }

  // El índice va DESPUÉS del nombre exacto: una organización llamada "2" era
  // inalcanzable por su nombre mientras hubiera dos o más (M2). Un índice fuera
  // de rango NO corta la resolución: "2024" puede ser parte de un nombre.
  if (opts.byIndex && /^\d+$/.test(trimmed)) {
    const idx = Number(trimmed) - 1;
    if (idx >= 0 && idx < items.length) return { kind: 'found', item: items[idx] };
  }

  const contains = items.filter((item) => nombre(item).includes(lower));
  if (contains.length === 1) return { kind: 'found', item: contains[0] };
  if (contains.length > 1) return { kind: 'ambiguous', matches: contains };
  return { kind: 'none' };
}
