import { describe, it, expect } from 'vitest';
import {
  localIsoWithOffset,
  localToUtc,
  localToUtcResolved,
  localNow,
  zonedParts,
} from './timezone.js';

describe('localToUtc', () => {
  it('Bolivia (UTC-4, sin DST): 21:00 local -> 01:00Z del día siguiente', () => {
    const utc = localToUtc('2026-03-10T21:00', 'America/La_Paz');
    expect(utc.toISOString()).toBe('2026-03-11T01:00:00.000Z');
  });

  it('Madrid en verano (CEST, UTC+2): 21:00 local -> 19:00Z mismo día', () => {
    const utc = localToUtc('2026-07-15T21:00', 'Europe/Madrid');
    expect(utc.toISOString()).toBe('2026-07-15T19:00:00.000Z');
  });

  it('Madrid en invierno (CET, UTC+1): 21:00 local -> 20:00Z mismo día', () => {
    const utc = localToUtc('2026-01-15T21:00', 'Europe/Madrid');
    expect(utc.toISOString()).toBe('2026-01-15T20:00:00.000Z');
  });

  it('México (UTC-6, sin DST desde 2022): 09:00 local -> 15:00Z mismo día', () => {
    const utc = localToUtc('2026-07-15T09:00', 'America/Mexico_City');
    expect(utc.toISOString()).toBe('2026-07-15T15:00:00.000Z');
  });

  it('formato inválido -> Date inválida (NaN), nunca lanza', () => {
    expect(Number.isNaN(localToUtc('no es una fecha', 'Europe/Madrid').getTime())).toBe(true);
    expect(Number.isNaN(localToUtc('2026-07-15T21:00:00Z', 'Europe/Madrid').getTime())).toBe(true);
  });
});

describe('localToUtcResolved', () => {
  it('marca exact:true cuando la hora local existe', () => {
    const r = localToUtcResolved('2026-07-15T21:00', 'Europe/Madrid');
    expect(r.exact).toBe(true);
    expect(r.date.toISOString()).toBe('2026-07-15T19:00:00.000Z');
  });

  it('marca exact:false en una hora que no existe por el salto de primavera (DST)', () => {
    // Madrid, 29-03-2026: a las 02:00 el reloj salta a las 03:00; las 02:30 no existen.
    const r = localToUtcResolved('2026-03-29T02:30', 'Europe/Madrid');
    expect(r.exact).toBe(false);
  });

  it('formato inválido -> fecha inválida y exact:false', () => {
    const r = localToUtcResolved('no es una fecha', 'Europe/Madrid');
    expect(Number.isNaN(r.date.getTime())).toBe(true);
    expect(r.exact).toBe(false);
  });
});

describe('zonedParts', () => {
  it('devuelve el calendario local de la zona, no el del servidor', () => {
    // 22:30Z del 16 = miércoles 16 a las 16:30 en México (UTC-6).
    const p = zonedParts(new Date('2026-09-16T22:30:00.000Z'), 'America/Mexico_City');
    expect({ y: p.y, m: p.m, d: p.d, h: p.h, mi: p.mi }).toEqual({
      y: 2026,
      m: 9,
      d: 16,
      h: 16,
      mi: 30,
    });
  });
});

describe('localNow', () => {
  it('devuelve la fecha COMPLETA y la hora local de la zona dada (no solo hh:mm)', () => {
    const now = new Date('2026-07-15T19:30:00.000Z');
    expect(localNow('Europe/Madrid', now)).toContain('21:30'); // CEST +2
    expect(localNow('Europe/Madrid', now)).toMatch(/15 de julio de 2026/);
    expect(localNow('America/La_Paz', now)).toContain('15:30'); // UTC-4
  });

  it('el día del cliente puede ser distinto del de Madrid', () => {
    // 22:30Z: en Madrid ya es el 17; en México sigue siendo el 16.
    const now = new Date('2026-09-16T22:30:00.000Z');
    expect(localNow('America/Mexico_City', now)).toMatch(/16 de septiembre de 2026/);
    expect(localNow('Europe/Madrid', now)).toMatch(/17 de septiembre de 2026/);
  });
});

describe('localIsoWithOffset', () => {
  it('Madrid tras el cambio de hora (CET, +01:00) y antes (CEST, +02:00)', () => {
    expect(localIsoWithOffset(new Date('2026-10-26T17:45:00Z'), 'Europe/Madrid')).toBe(
      '2026-10-26T18:45:00+01:00'
    );
    expect(localIsoWithOffset(new Date('2026-10-24T17:45:00Z'), 'Europe/Madrid')).toBe(
      '2026-10-24T19:45:00+02:00'
    );
  });

  it('zona al oeste de UTC: desfase negativo y cambio de día', () => {
    expect(localIsoWithOffset(new Date('2026-03-11T01:30:00Z'), 'America/La_Paz')).toBe(
      '2026-03-10T21:30:00-04:00'
    );
  });
});
