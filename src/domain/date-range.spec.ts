import { describe, it, expect } from 'vitest';
import { resolveDateRange } from './date-range.js';
import { localToUtc } from './timezone.js';

const MADRID = 'Europe/Madrid';
const MEXICO = 'America/Mexico_City';

// Fijo en UTC: 2026-07-30T10:00:00Z (jueves) = 12:00 en Madrid.
const now = new Date('2026-07-30T10:00:00.000Z');

/** Medianoche local de `tz` para el día dado, en ISO UTC. */
function midnight(ymd: string, tz: string): string {
  return localToUtc(`${ymd}T00:00`, tz).toISOString();
}

describe('resolveDateRange — periodos en la zona del cliente', () => {
  it('sin periodo/desde/hasta -> sin rango de fechas, limit=10', () => {
    expect(resolveDateRange(undefined, undefined, undefined, now, MADRID)).toEqual({ limit: 10 });
  });

  it("periodo 'todos' -> sin rango de fechas, limit=10", () => {
    expect(resolveDateRange('todos', undefined, undefined, now, MADRID)).toEqual({ limit: 10 });
  });

  it("periodo 'hoy' -> [hoy 00:00 del cliente, now], limit=100", () => {
    expect(resolveDateRange('hoy', undefined, undefined, now, MADRID)).toEqual({
      dateFrom: midnight('2026-07-30', MADRID),
      dateTo: now.toISOString(),
      limit: 100,
    });
  });

  it("periodo 'ayer' -> [ayer 00:00, hoy 00:00) del cliente, limit=100", () => {
    expect(resolveDateRange('ayer', undefined, undefined, now, MADRID)).toEqual({
      dateFrom: midnight('2026-07-29', MADRID),
      dateTo: midnight('2026-07-30', MADRID),
      limit: 100,
    });
  });

  it("periodo 'ultimos_7_dias' -> [hace 7 días 00:00, now], limit=100", () => {
    expect(resolveDateRange('ultimos_7_dias', undefined, undefined, now, MADRID)).toEqual({
      dateFrom: midnight('2026-07-23', MADRID),
      dateTo: now.toISOString(),
      limit: 100,
    });
  });

  it("periodo 'ultimos_30_dias' -> [hace 30 días 00:00, now], limit=100", () => {
    expect(resolveDateRange('ultimos_30_dias', undefined, undefined, now, MADRID)).toEqual({
      dateFrom: midnight('2026-06-30', MADRID),
      dateTo: now.toISOString(),
      limit: 100,
    });
  });

  it('desde/hasta explícitos -> desde 00:00 local, hasta+1 día 00:00 local (exclusivo)', () => {
    expect(resolveDateRange(undefined, '2026-07-01', '2026-07-15', now, MADRID)).toEqual({
      dateFrom: midnight('2026-07-01', MADRID),
      dateTo: midnight('2026-07-16', MADRID),
      limit: 100,
    });
  });

  it('solo desde -> dateFrom fijado, dateTo indefinido', () => {
    expect(resolveDateRange(undefined, '2026-07-01', undefined, now, MADRID)).toEqual({
      dateFrom: midnight('2026-07-01', MADRID),
      limit: 100,
    });
  });

  it('desde/hasta tienen prioridad sobre periodo', () => {
    expect(resolveDateRange('hoy', '2026-07-01', '2026-07-02', now, MADRID)).toEqual({
      dateFrom: midnight('2026-07-01', MADRID),
      dateTo: midnight('2026-07-03', MADRID),
      limit: 100,
    });
  });

  it('el mismo "desde" da límites distintos en México que en Madrid (día del cliente, no del servidor)', () => {
    const enMexico = resolveDateRange(undefined, '2026-09-16', undefined, now, MEXICO);
    const enMadrid = resolveDateRange(undefined, '2026-09-16', undefined, now, MADRID);
    expect(enMexico.dateFrom).toBe('2026-09-16T06:00:00.000Z'); // 00:00 CDT = 06:00Z
    expect(enMadrid.dateFrom).toBe('2026-09-15T22:00:00.000Z'); // 00:00 CEST = 22:00Z del día anterior
    expect(enMexico.dateFrom).not.toBe(enMadrid.dateFrom);
  });

  it("'hoy' para un cliente mexicano usa SU día natural, aunque en Madrid ya sea el siguiente", () => {
    // 2026-09-16T22:30Z: en Madrid ya es el 17; en México sigue siendo el 16.
    const medianoche = new Date('2026-09-16T22:30:00.000Z');
    const r = resolveDateRange('hoy', undefined, undefined, medianoche, MEXICO);
    expect(r.dateFrom).toBe(midnight('2026-09-16', MEXICO));
  });

  it('sin `tz` explícito usa la zona por defecto (Europe/Madrid)', () => {
    expect(resolveDateRange('hoy', undefined, undefined, now).dateFrom).toBe(
      midnight('2026-07-30', MADRID)
    );
  });
});

describe('resolveDateRange — fechas inválidas', () => {
  it("desde:'ayer' no lanza: se ignora el parámetro y se avisa", () => {
    const r = resolveDateRange(undefined, 'ayer', undefined, now, MADRID);
    expect(r.dateFrom).toBeUndefined();
    expect(r.avisos?.join(' ')).toMatch(/desde/i);
    expect(r.limit).toBe(10); // sin rango válido ni periodo, se cae al listado reciente
  });

  it("hasta:'última semana' no lanza y no contamina el rango", () => {
    const r = resolveDateRange(undefined, '2026-07-01', 'última semana', now, MADRID);
    expect(r.dateFrom).toBe(midnight('2026-07-01', MADRID));
    expect(r.dateTo).toBeUndefined();
    expect(r.avisos?.join(' ')).toMatch(/hasta/i);
  });

  it('una fecha con formato correcto pero inexistente (2026-02-31) se rechaza igual', () => {
    const r = resolveDateRange(undefined, '2026-02-31', undefined, now, MADRID);
    expect(r.dateFrom).toBeUndefined();
    expect(r.avisos?.length).toBe(1);
  });

  it('rango invertido (desde > hasta): no se filtra por fecha y se avisa', () => {
    const r = resolveDateRange(undefined, '2026-07-15', '2026-07-01', now, MADRID);
    expect(r.dateFrom).toBeUndefined();
    expect(r.dateTo).toBeUndefined();
    expect(r.avisos?.join(' ')).toMatch(/invertido/i);
  });

  it('rango invertido con periodo: se usa el periodo y se avisa igualmente', () => {
    const r = resolveDateRange('hoy', '2026-07-15', '2026-07-01', now, MADRID);
    expect(r.dateFrom).toBe(midnight('2026-07-30', MADRID));
    expect(r.avisos?.join(' ')).toMatch(/invertido/i);
  });

  it('desde == hasta sigue siendo un rango válido (un día entero)', () => {
    const r = resolveDateRange(undefined, '2026-07-15', '2026-07-15', now, MADRID);
    expect(r.dateFrom).toBe(midnight('2026-07-15', MADRID));
    expect(r.dateTo).toBe(midnight('2026-07-16', MADRID));
    expect(r.avisos).toBeUndefined();
  });

  it('con desde inválido pero periodo válido, se usa el periodo y se avisa', () => {
    const r = resolveDateRange('hoy', 'ayer', undefined, now, MADRID);
    expect(r.dateFrom).toBe(midnight('2026-07-30', MADRID));
    expect(r.avisos?.join(' ')).toMatch(/desde/i);
  });
});
