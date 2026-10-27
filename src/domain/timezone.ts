/**
 * Resuelve la zona horaria del cliente y convierte horas locales ⇄ UTC sin
 * librerías externas, apoyándose en `Intl.DateTimeFormat` (disponible en Node).
 */

export const DEFAULT_TIMEZONE = 'Europe/Madrid';

/**
 * Calendario local (año, mes, día, hora, minuto, segundo) de un instante en `tz`.
 * Es la pieza con la que se calculan los límites de día en la zona del cliente
 * (ver `date-range.ts`), en vez de en la hora del servidor.
 */
export function zonedParts(
  instant: Date,
  tz: string
): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: get('hour'),
    mi: get('minute'),
    s: get('second'),
  };
}

/**
 * Desfase de `tz` respecto a UTC en `at`, en minutos (Madrid en verano: +120;
 * Bogotá: -300). Con el de HOY se convierten los horarios de las rutas, igual
 * que el panel; el backend los reproyecta al cambiar la hora con la zona que
 * viaja junto a ellos.
 */
export function utcOffsetMinutes(tz: string, at: Date = new Date()): number {
  const p = zonedParts(at, tz);
  const localAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((localAsUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

const LOCAL_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Convierte una hora LOCAL sin zona ("YYYY-MM-DDTHH:mm", la hora del cliente)
 * al instante UTC correspondiente en `tz`.
 *
 * Sin librería de zonas horarias, se calcula el offset con
 * `Intl.DateTimeFormat` en dos pasadas: (1) se asume el instante en UTC y se
 * mira qué hora local cae en `tz`; (2) la diferencia con la hora pedida corrige
 * el instante. Dos pasadas bastan salvo pegado a una transición de DST, así
 * que se repite hasta que no queda diferencia (máx. 3 iteraciones).
 *
 * `exact` distingue "convergió" de "no existe esa hora local" (el salto de
 * primavera: en Madrid las 02:30 del cambio no existen y se resuelven a 01:30
 * local). Quien programa algo a esa hora debe poder avisarlo (M4).
 */
export function localToUtcResolved(localIso: string, tz: string): { date: Date; exact: boolean } {
  const m = LOCAL_ISO_RE.exec(localIso);
  if (!m) return { date: new Date(NaN), exact: false };
  const [, yStr, moStr, dStr, hStr, miStr] = m;
  const targetUtcMs = Date.UTC(
    Number(yStr),
    Number(moStr) - 1,
    Number(dStr),
    Number(hStr),
    Number(miStr),
    0
  );

  let guess = targetUtcMs;
  let exact = false;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz);
    const gotUtcMs = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    const diff = targetUtcMs - gotUtcMs;
    if (diff === 0) {
      exact = true;
      break;
    }
    guess += diff;
  }
  return { date: new Date(guess), exact };
}

/** Igual que `localToUtcResolved`, quedándose solo con el instante. */
export function localToUtc(localIso: string, tz: string): Date {
  return localToUtcResolved(localIso, tz).date;
}

/**
 * Fecha y hora local actual del cliente en `tz` ("miércoles, 16 de septiembre
 * de 2026, 16:30").
 *
 * Devuelve la fecha COMPLETA a propósito: con solo "hh:mm" el modelo calculaba
 * "mañana" sobre el calendario de Madrid y programaba citas y recordatorios un
 * día tarde para los clientes de América.
 */
export function localNow(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: tz,
    dateStyle: 'full',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(now);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Un instante como hora LOCAL de `tz` con su desfase, en ISO 8601
 * («2026-10-26T18:45:00+01:00»): para los canales que dan horas a un modelo,
 * que pasa mal UTC a hora local alrededor del cambio de hora.
 */
export function localIsoWithOffset(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  const offset = utcOffsetMinutes(tz, instant);
  const abs = Math.abs(offset);
  const sign = offset < 0 ? '-' : '+';
  return (
    `${String(p.y)}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}
