import { afterEach, describe, it, expect, vi } from 'vitest';
import { readHarness, type FakePatrolTechGateway } from '../testing/index.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('consultar_ultimos_scans — filtros', () => {
  it('resuelve vigilante, ubicación y checkpoint por nombre a sus ids y pasa sospechosos/no válidos', async () => {
    const { run, gateway } = readHarness();

    const out = await run('consultar_ultimos_scans', {
      vigilante: 'juan',
      ubicacion: 'Central',
      checkpoint: 'entrada',
      solo_sospechosos: true,
      solo_no_validos: true,
      periodo: 'ayer',
    });

    expect(out.ok).toBe(true);
    expect(gateway.scanOpts.at(-1)).toMatchObject({
      patrollerId: 'p-juan',
      locationId: 'loc-central',
      checkpointId: 'cp-entrada',
      soloSospechosos: true,
      soloNoValidos: true,
      limit: 100,
    });
    expect(gateway.scanOpts.at(-1)?.dateFrom).toBeDefined();
  });

  it('sin filtros no resuelve nada ni manda ids', async () => {
    const { run, gateway } = readHarness();

    await run('consultar_ultimos_scans', {});

    const opts = gateway.scanOpts.at(-1);
    expect(opts?.patrollerId).toBeUndefined();
    expect(opts?.checkpointId).toBeUndefined();
    expect(opts?.locationId).toBeUndefined();
  });

  it('vigilante ambiguo: pregunta con las opciones y no consulta escaneos', async () => {
    const { run, gateway } = readHarness();
    gateway.patrollers.push({
      id: 'p-juan2',
      name: 'Juan García',
      identifier: 'C0FFEE00',
      lastScanAt: null,
    });

    const out = await run('consultar_ultimos_scans', { vigilante: 'Juan' });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/^ambigua/);
    expect(out.opciones).toEqual(['Juan Pérez', 'Juan García']);
    expect(gateway.scanOpts).toHaveLength(0);
  });

  it('checkpoint desconocido: no encontrado con los checkpoints y su ubicación', async () => {
    const { run, gateway } = readHarness();

    const out = await run('consultar_ultimos_scans', { checkpoint: 'Azotea' });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/^no encontrado/);
    expect(out.opciones).toContain('Entrada principal (Sede Central)');
    expect(gateway.scanOpts).toHaveLength(0);
  });

  it('el checkpoint se busca solo dentro de la ubicación indicada', async () => {
    const { run } = readHarness();

    const out = await run('consultar_ultimos_scans', { ubicacion: 'Norte', checkpoint: 'Entrada' });

    expect(out.ok).toBe(false);
    expect(out.opciones).toEqual(['Recepción (Sucursal Norte)']);
  });
});

describe('identificador de los checkpoints (B1)', () => {
  it('obtener_checkpoints devuelve el identificador de cada checkpoint', async () => {
    const { run, gateway } = readHarness();
    gateway.checkpointRefs = gateway.checkpointRefs.map((c, i) => ({
      ...c,
      identificador: `ID00000${i}`,
    }));

    const out = await run('obtener_checkpoints');

    expect(out.ok).toBe(true);
    expect((out.data as unknown as unknown[])[0]).toEqual({
      id: 'cp-entrada',
      name: 'Entrada principal',
      locationName: 'Sede Central',
      identificador: 'ID000000',
    });
  });

  it('la descripción explica que es el código de 8 caracteres de la columna «Identificador»', () => {
    const { reads } = readHarness();
    const description = reads.find((r) => r.name === 'obtener_checkpoints')?.description;
    expect(description).toMatch(/Identificador/);
    expect(description).toMatch(/8 caracteres/);
  });
});

describe('consultar_checkpoints_sin_revisar', () => {
  const conPrimerEscaneo = (pt: FakePatrolTechGateway): void => {
    pt.checkpointRefs = pt.checkpointRefs.map((c) => ({
      ...c,
      primerEscaneo: c.id === 'cp-almacen' ? null : '2026-01-01T00:00:00Z',
    }));
  };

  it('nunca escaneados primero, luego sin escaneos visibles y luego de más a menos días; para en cuanto encuentra lo que busca', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-08T08:00:00Z'));
    const { run, gateway } = readHarness();
    conPrimerEscaneo(gateway);

    const out = await run('consultar_checkpoints_sin_revisar');

    expect(out.data?.checkpoints).toEqual([
      {
        checkpoint: 'Almacén',
        ubicacion: 'Sede Central',
        ultimoEscaneo: null,
        diasSinEscanear: null,
        nuncaEscaneado: true,
      },
      {
        checkpoint: 'Recepción',
        ubicacion: 'Sucursal Norte',
        ultimoEscaneo: null,
        diasSinEscanear: null,
        sinEscaneosVisibles: true,
      },
      {
        checkpoint: 'Entrada principal',
        ubicacion: 'Sede Central',
        ultimoEscaneo: '2026-07-29T08:00:00Z',
        diasSinEscanear: 10,
      },
    ]);
    // Una página por ubicación: la de Sede Central ya trae «Entrada principal».
    expect(gateway.scanOpts).toEqual([
      { locationId: 'loc-central', limit: 100, page: 1 },
      { locationId: 'loc-norte', limit: 100, page: 1 },
    ]);
  });

  it('filtra por ubicación y por días mínimos', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-08T08:00:00Z'));
    const { run, gateway } = readHarness();
    conPrimerEscaneo(gateway);

    const norte = await run('consultar_checkpoints_sin_revisar', { ubicacion: 'Norte' });
    const viejos = await run('consultar_checkpoints_sin_revisar', { dias_minimos: 20 });

    expect((norte.data?.checkpoints as { checkpoint: string }[]).map((c) => c.checkpoint)).toEqual([
      'Recepción',
    ]);
    expect((viejos.data?.checkpoints as { checkpoint: string }[]).map((c) => c.checkpoint)).toEqual(
      ['Almacén', 'Recepción']
    );
  });

  it('con el tope de escaneos leídos, lo no visto sale como «al menos N días» y avisa', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-08T08:00:00Z'));
    const { run, gateway } = readHarness();
    gateway.checkpointRefs = [
      {
        id: 'cp-entrada',
        name: 'Entrada principal',
        locationId: 'loc-central',
        locationName: 'Sede Central',
        metodo: 'qr_static',
        codigo: null,
      },
    ];
    gateway.scans = Array.from({ length: 2050 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 7, 8) - i * 3600_000).toISOString(),
      checkpointName: 'Otro',
      patrollerName: 'Juan Pérez',
      fraudFlagged: false,
      validacion: 'válido',
      motivosSospecha: [],
    }));

    const out = await run('consultar_checkpoints_sin_revisar');

    expect(gateway.scanOpts).toHaveLength(20);
    expect(out.data?.checkpoints).toEqual([
      {
        checkpoint: 'Entrada principal',
        ubicacion: 'Sede Central',
        ultimoEscaneo: null,
        diasSinEscanear: 83,
        alMenos: true,
      },
    ]);
    expect(out.avisos?.join(' ')).toMatch(/2000 escaneos más recientes.*COMO MÍNIMO/);
  });
});
