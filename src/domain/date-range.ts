import { DEFAULT_TIMEZONE, localToUtc, zonedParts } from './timezone.js';

export type Periodo = 'hoy' | 'ayer' | 'ultimos_7_dias' | 'ultimos_30_dias' | 'todos';

export interface DateRange {
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  /** Avisos para el modelo (p. ej. un `desde` que no era una fecha y se ignoró). */
  avisos?: string[];
}

const RECENT_LIMIT = 10;
const RANGE_LIMIT = 100;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Valida 'YYYY-MM-DD' y devuelve sus partes, o `null` si no es una fecha real.
 *
 * Antes construía una `Date` y `desde: 'ayer'` acababa en `Invalid Date` →
 * `.toISOString()` lanzaba → el turno entero caía en el fallback con un escalado
 * espurio. Ahora el parámetro malo se ignora y se avisa al modelo.
 */
export function parseLocalDate(ymd: string): { y: number; m: number; d: number } | null {
  const match = YMD_RE.exec(ymd.trim());
  if (!match) return null;
  const [, yStr, mStr, dStr] = match;
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Rechaza días que no existen en ese mes (31 de febrero, 30 de febrero…).
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d)
    return null;
  return { y, m, d };
}

function ymdToString({ y, m, d }: { y: number; m: number; d: number }): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Día natural desplazado `days` días (aritmética de calendario, no de instantes). */
function shiftDays(
  ymd: { y: number; m: number; d: number },
  days: number
): { y: number; m: number; d: number } {
  const shifted = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** Instante UTC de las 00:00 del día natural `ymd` en la zona `tz`. */
function startOfDay(ymd: { y: number; m: number; d: number }, tz: string): string {
  return localToUtc(`${ymdToString(ymd)}T00:00`, tz).toISOString();
}

/** Día natural del cliente (en `tz`) correspondiente al instante `now`. */
function todayIn(now: Date, tz: string): { y: number; m: number; d: number } {
  const parts = zonedParts(now, tz);
  return { y: parts.y, m: parts.m, d: parts.d };
}

/**
 * Resuelve el periodo o rango de fechas pedido por el usuario a un `dateFrom`/
 * `dateTo` en ISO (para filtrar en la API) y el `limit` a pedir.
 *
 * Los límites de día se calculan en el calendario del CLIENTE (`tz`, la que sale
 * de su prefijo telefónico), no en la hora del servidor: "los escaneos del 16"
 * para un cliente de México empezaban a las 16:00 del día 15.
 *
 * Nunca lanza: un `desde`/`hasta` que no sea una fecha real se ignora y se
 * devuelve el motivo en `avisos` para que el modelo pueda decirlo o reintentar.
 */
export function resolveDateRange(
  periodo?: Periodo,
  desde?: string,
  hasta?: string,
  now: Date = new Date(),
  tz: string = DEFAULT_TIMEZONE
): DateRange {
  const avisos: string[] = [];

  let desdeYmd = desde ? parseLocalDate(desde) : null;
  if (desde && !desdeYmd)
    avisos.push(
      `El parámetro «desde» («${desde}») no es una fecha YYYY-MM-DD válida: se ha ignorado.`
    );
  let hastaYmd = hasta ? parseLocalDate(hasta) : null;
  if (hasta && !hastaYmd)
    avisos.push(
      `El parámetro «hasta» («${hasta}») no es una fecha YYYY-MM-DD válida: se ha ignorado.`
    );

  // Rango invertido: pedirlo a la API devolvería SIEMPRE cero resultados y el
  // modelo lo leería como "no hubo actividad". Se descarta el rango y se dice.
  if (desdeYmd && hastaYmd && ymdToString(desdeYmd) > ymdToString(hastaYmd)) {
    avisos.push(
      `El rango está invertido («desde» ${ymdToString(desdeYmd)} es posterior a «hasta» ${ymdToString(hastaYmd)}): no se ha filtrado por fecha. Corrige las fechas y vuelve a intentarlo.`
    );
    desdeYmd = null;
    hastaYmd = null;
  }

  const withAvisos = (range: DateRange): DateRange =>
    avisos.length > 0 ? { ...range, avisos } : range;

  if (desdeYmd || hastaYmd) {
    return withAvisos({
      ...(desdeYmd ? { dateFrom: startOfDay(desdeYmd, tz) } : {}),
      ...(hastaYmd ? { dateTo: startOfDay(shiftDays(hastaYmd, 1), tz) } : {}),
      limit: RANGE_LIMIT,
    });
  }

  const today = todayIn(now, tz);
  switch (periodo) {
    case 'hoy':
      return withAvisos({
        dateFrom: startOfDay(today, tz),
        dateTo: now.toISOString(),
        limit: RANGE_LIMIT,
      });
    case 'ayer':
      return withAvisos({
        dateFrom: startOfDay(shiftDays(today, -1), tz),
        dateTo: startOfDay(today, tz),
        limit: RANGE_LIMIT,
      });
    case 'ultimos_7_dias':
      return withAvisos({
        dateFrom: startOfDay(shiftDays(today, -7), tz),
        dateTo: now.toISOString(),
        limit: RANGE_LIMIT,
      });
    case 'ultimos_30_dias':
      return withAvisos({
        dateFrom: startOfDay(shiftDays(today, -30), tz),
        dateTo: now.toISOString(),
        limit: RANGE_LIMIT,
      });
    case 'todos':
    default:
      return withAvisos({ limit: RECENT_LIMIT });
  }
}
