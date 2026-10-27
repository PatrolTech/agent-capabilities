import { describe, it, expect } from 'vitest';
import { readHarness } from '../testing/index.js';

describe('consultar_puesta_en_marcha', () => {
  it('con todo hecho: hitos y puesta en marcha completa', async () => {
    const { run } = readHarness();

    const out = await run('consultar_puesta_en_marcha');

    expect(out.data).toMatchObject({
      checkpointsCreados: 24,
      vigilantes: 8,
      vigilantesConAlgunEscaneo: 1,
      hayEscaneos: true,
      rutasCreadas: 2,
    });
    expect(out.data?.siguientePaso).toMatch(/completa/);
  });

  it('sin checkpoints: el siguiente paso es crear el primero', async () => {
    const { run, gateway } = readHarness();
    gateway.supportSummary = { ...gateway.supportSummary, checkpoints: { total: 0 } };

    const out = await run('consultar_puesta_en_marcha');

    expect(out.data?.siguientePaso).toMatch(/primer checkpoint/);
  });

  it('vigilantes sin ningún escaneo: el siguiente paso es enviarles el enlace de la app', async () => {
    const { run, gateway } = readHarness();
    gateway.patrollers = gateway.patrollers.map((p) => ({ ...p, lastScanAt: null }));
    gateway.scans = [];

    const out = await run('consultar_puesta_en_marcha');

    expect(out.data).toMatchObject({
      vigilantesConAlgunEscaneo: 0,
      hayEscaneos: false,
      ultimoEscaneo: null,
    });
    expect(out.data?.siguientePaso).toMatch(/enlace de la app/);
  });
});
