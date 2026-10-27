import { describe, it, expect } from 'vitest';
import { FakePatrolTechGateway } from './FakePatrolTechGateway.js';

describe('FakePatrolTechGateway', () => {
  it('devuelve estado de rondas y registra el accountId', async () => {
    const c = new FakePatrolTechGateway();
    const r = await c.getRoundsStatus('acc-1', 'jwt');
    expect(r).toHaveProperty('open');
    expect(c.calls).toContain('acc-1');
  });

  it('devuelve actividad de vigilantes', async () => {
    const c = new FakePatrolTechGateway();
    const a = await c.getPatrollerActivity('acc-1', 'jwt');
    expect(Array.isArray(a.items)).toBe(true);
    expect(a.items[0]).toHaveProperty('status');
    expect(a.truncado).toBe(false);
  });

  it('devuelve últimos scans y registra el accountId', async () => {
    const c = new FakePatrolTechGateway();
    const scans = await c.getRecentScans('acc-1', 'jwt');
    expect(Array.isArray(scans.items)).toBe(true);
    expect(scans.items[0]).toHaveProperty('fraudFlagged');
    expect(scans.items[1]?.motivosSospecha.length).toBeGreaterThan(0);
    expect(c.calls).toContain('acc-1');
  });

  it('devuelve detalle de rondas por ruta y registra el accountId', async () => {
    const c = new FakePatrolTechGateway();
    const detail = await c.getRoundsDetail('acc-1', 'jwt');
    expect(Array.isArray(detail.items)).toBe(true);
    expect(detail.items[0]).toHaveProperty('routeName');
    expect(detail.items[0]).toHaveProperty('rounds');
    expect(c.calls).toContain('acc-1');
  });

  it('con truncado=true, las listas lo señalan (para probar el aviso al modelo)', async () => {
    const c = new FakePatrolTechGateway();
    c.truncado = true;
    expect((await c.getRecentScans('acc-1', 'jwt')).truncado).toBe(true);
    expect((await c.getCheckpoints('acc-1', 'jwt')).truncado).toBe(true);
    expect((await c.getPatrollerRanking('acc-1', 'jwt')).truncado).toBe(true);
  });

  it('un vigilante vacío no resuelve a nadie (mismo invariante que el cliente real)', async () => {
    const c = new FakePatrolTechGateway();
    expect(await c.getPatrollerStats('acc-1', 'jwt', '')).toEqual({
      found: false,
      opciones: ['Juan García', 'María López'],
    });
  });
});
