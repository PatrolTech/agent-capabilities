import { describe, it, expect } from 'vitest';
import type { RoundRef } from '../gateway/index.js';
import { readHarness } from '../testing/index.js';

/** `n` rondas, una por hora hacia atrás desde `base` (la más reciente primero, como el backend). */
function hourlyRounds(base: number, n: number): RoundRef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `h-${i}`,
    status: 'completed',
    patrollerName: 'Juan Pérez',
    completedCheckpoints: 3,
    totalCheckpoints: 3,
    startTime: new Date(base - i * 3600_000).toISOString(),
    endTime: null,
  }));
}

describe('consultar_ronda', () => {
  it('sin fecha: la última ronda de la única ruta activa, con puntos hechos y pendientes', async () => {
    const { run, gateway } = readHarness();

    const out = await run('consultar_ronda');

    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({
      ruta: 'Ruta Norte',
      inicio: '2026-07-29T20:00:00Z',
      escaneados: 2,
      total: 3,
      hechos: [
        { checkpoint: 'Entrada principal', hora: '2026-07-28T21:05:00Z' },
        { checkpoint: 'Almacén', hora: '2026-07-28T21:20:00Z' },
      ],
      pendientes: ['Azotea'],
    });
    expect(gateway.roundDetailCalls).toEqual(['rd-3']);
  });

  it('«anoche» (fecha de ayer y hora 23:00 del cliente): la ronda que empezó más cerca', async () => {
    const { run, gateway } = readHarness();

    // 23:00 en Madrid en julio = 21:00 UTC.
    const out = await run('consultar_ronda', { ruta: 'Norte', fecha: '2026-07-28', hora: '23:00' });

    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({
      inicio: '2026-07-28T21:00:00Z',
      vigilante: 'Ana López',
      otrasRondasCercanas: [],
    });
    expect(gateway.roundDetailCalls).toEqual(['rd-2']);
  });

  it('solo fecha: cualquier ronda de ese día', async () => {
    const { run, gateway } = readHarness();

    const out = await run('consultar_ronda', { ruta: 'Ruta Norte', fecha: '2026-07-20' });

    expect(out.ok).toBe(true);
    expect(gateway.roundDetailCalls).toEqual(['rd-1']);
  });

  it('sin rondas cerca de la fecha: falla con las más próximas para elegir', async () => {
    const { run, gateway } = readHarness();

    const out = await run('consultar_ronda', { ruta: 'Norte', fecha: '2026-07-10' });

    expect(out.ok).toBe(false);
    expect(out.opciones?.[0]).toBe('2026-07-20T06:00:00Z');
    expect(gateway.roundDetailCalls).toEqual([]);
  });

  it('pagina hacia atrás hasta llegar a la fecha', async () => {
    const { run, gateway } = readHarness();
    const base = Date.parse('2026-07-29T00:00:00Z');
    gateway.rounds['r-norte'] = hourlyRounds(base, 120);

    // Ronda 110 → base - 110 h = 2026-07-24T10:00Z = 12:00 en Madrid.
    const out = await run('consultar_ronda', { ruta: 'Norte', fecha: '2026-07-24', hora: '12:00' });

    expect(out.ok).toBe(true);
    expect(gateway.roundPageCalls).toEqual(['r-norte:1', 'r-norte:2', 'r-norte:3']);
    expect(gateway.roundDetailCalls).toEqual(['h-110']);
  });

  it('una fecha más allá de las páginas que se consultan: lo dice en vez de inventar', async () => {
    const { run, gateway } = readHarness();
    gateway.rounds['r-norte'] = hourlyRounds(Date.parse('2026-07-29T00:00:00Z'), 400);

    const out = await run('consultar_ronda', { ruta: 'Norte', fecha: '2026-07-12', hora: '12:00' });

    expect(out.ok).toBe(false);
    expect(out.error).toContain('300 más recientes');
    expect(gateway.roundPageCalls).toHaveLength(6);
  });

  it('sin ruta con varias activas: pregunta cuál', async () => {
    const { run, gateway } = readHarness();
    gateway.routes = gateway.routes.map((r) => ({ ...r, isActive: true }));

    const out = await run('consultar_ronda');

    expect(out.ok).toBe(false);
    expect(out.opciones).toEqual(['Ruta Norte', 'Ruta Sur']);
  });

  it('ruta sin rondas: lo dice como hecho', async () => {
    const { run } = readHarness();

    const out = await run('consultar_ronda', { ruta: 'Sur' });

    expect(out).toMatchObject({ ok: true, data: { ruta: 'Ruta Sur', ronda: null } });
  });
});
