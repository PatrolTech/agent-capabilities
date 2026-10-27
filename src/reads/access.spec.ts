import { afterEach, describe, it, expect, vi } from 'vitest';
import { PatrolTechApiError } from '../domain/backend-errors.js';
import type { AccessLogEntry } from '../gateway/index.js';
import { readHarness } from '../testing/index.js';

afterEach(() => {
  vi.useRealTimers();
});

const acceso = (
  o: Partial<AccessLogEntry> & Pick<AccessLogEntry, 'id' | 'fecha'>
): AccessLogEntry => ({
  locationId: 'loc-central',
  zona: null,
  tipo: 'ENTRY',
  persona: null,
  identificadorPersona: null,
  visitante: null,
  documentoVisitante: null,
  empresaVisitante: null,
  destino: null,
  notas: null,
  oculto: false,
  ...o,
});

const ACCESOS: AccessLogEntry[] = [
  acceso({
    id: 'a1',
    fecha: '2026-10-10T07:00:00.000Z',
    persona: 'Luis Gil',
    identificadorPersona: 'EMP-7',
    zona: 'Portería',
  }),
  acceso({
    id: 'a2',
    fecha: '2026-10-10T06:30:00.000Z',
    tipo: 'EXIT',
    visitante: 'Ana Sanz',
    documentoVisitante: '12345678Z',
    empresaVisitante: 'Limpiezas SA',
  }),
  acceso({
    id: 'a3',
    fecha: '2026-10-10T05:00:00.000Z',
    locationId: 'loc-norte',
    visitante: 'Ana Sanz',
    documentoVisitante: '12345678Z',
  }),
  acceso({ id: 'a4', fecha: '2026-10-05T05:00:00.000Z', persona: 'Antiguo' }),
];

const ahora = (iso: string) => vi.useFakeTimers({ now: new Date(iso), toFake: ['Date'] });

describe('consultar_accesos (B3)', () => {
  it('por defecto, las últimas 24 h de todas las ubicaciones: totales y últimos registros, sin documento del visitante', async () => {
    ahora('2026-10-10T08:00:00.000Z');
    const { run, gateway } = readHarness();
    gateway.accessLogs = ACCESOS;

    const out = await run('consultar_accesos');

    expect(out.ok).toBe(true);
    expect(gateway.accessLogQueries[0]).toMatchObject({
      locationId: 'loc-central',
      desde: '2026-10-09T08:00:00.000Z',
      hasta: '2026-10-10T08:00:00.000Z',
    });
    expect(new Set(gateway.accessLogQueries.map((q) => q.locationId))).toEqual(
      new Set(['loc-central', 'loc-norte'])
    );
    expect(out.data).toMatchObject({ total: 3, entradas: 2, salidas: 1 });
    expect(out.data?.ultimos).toEqual([
      {
        hora: '2026-10-10 09:00',
        tipo: 'Entrada',
        quien: 'Luis Gil',
        zona: 'Portería',
        ubicacion: 'Sede Central',
      },
      {
        hora: '2026-10-10 08:30',
        tipo: 'Salida',
        quien: 'Ana Sanz (visitante, Limpiezas SA)',
        zona: null,
        ubicacion: 'Sede Central',
      },
      {
        hora: '2026-10-10 07:00',
        tipo: 'Entrada',
        quien: 'Ana Sanz (visitante)',
        zona: null,
        ubicacion: 'Sucursal Norte',
      },
    ]);
    expect(JSON.stringify(out)).not.toContain('12345678Z');
  });

  it('filtra por ubicación, zona y tipo', async () => {
    ahora('2026-10-10T08:00:00.000Z');
    const { run, gateway } = readHarness();
    gateway.accessLogs = ACCESOS;

    const out = await run('consultar_accesos', {
      ubicacion: 'central',
      zona: 'Portería',
      tipo: 'entrada',
    });

    expect(out.ok).toBe(true);
    expect(
      gateway.accessLogQueries.every(
        (q) => q.locationId === 'loc-central' && q.zona === 'Portería' && q.tipo === 'ENTRY'
      )
    ).toBe(true);
    expect(out.data).toMatchObject({ total: 1, entradas: 1, salidas: 0 });
  });

  it('«quién está dentro ahora»: las entradas activas de cada ubicación', async () => {
    ahora('2026-10-10T08:00:00.000Z');
    const { run, gateway } = readHarness();
    gateway.activeAccessEntries = [ACCESOS[0], { ...ACCESOS[2] }];

    const out = await run('consultar_accesos', { solo_dentro: true });

    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ dentroAhora: 2 });
    expect(JSON.stringify(out)).not.toContain('12345678Z');
  });

  it('con más de 20 registros, avisa y ofrece el Excel', async () => {
    ahora('2026-10-10T08:00:00.000Z');
    const { run, gateway } = readHarness();
    gateway.accessLogs = Array.from({ length: 30 }, (_, i) =>
      acceso({
        id: `x${i}`,
        fecha: new Date(Date.parse('2026-10-10T07:00:00.000Z') - i * 60_000).toISOString(),
        persona: `P${i}`,
      })
    );

    const out = await run('consultar_accesos');

    expect(out.data).toMatchObject({ total: 30 });
    expect((out.data?.ultimos as unknown[]).length).toBe(20);
    expect(out.avisos?.join(' ')).toMatch(/enviar_excel_accesos/);
  });

  it('sin FileSink, el aviso remite al panel en vez de al Excel', async () => {
    ahora('2026-10-10T08:00:00.000Z');
    const { run, gateway } = readHarness({ withFiles: false });
    gateway.accessLogs = Array.from({ length: 30 }, (_, i) =>
      acceso({
        id: `x${i}`,
        fecha: new Date(Date.parse('2026-10-10T07:00:00.000Z') - i * 60_000).toISOString(),
      })
    );

    const out = await run('consultar_accesos');

    expect(out.avisos?.join(' ')).toMatch(/está en el panel \(Control de Acceso\)/);
    expect(out.avisos?.join(' ')).not.toMatch(/enviar_excel_accesos/);
  });

  it('Control de Acceso sin activar: lo explica', async () => {
    const { run, gateway } = readHarness();
    gateway.accessLogsError = new PatrolTechApiError(403, '/x', {
      success: false,
      message: "Feature 'access-control' is not enabled",
    });

    const out = await run('consultar_accesos');

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Control de Acceso/);
  });
});

describe('consultar_accesos: casos límite', () => {
  it('una ubicación sin permiso (403 que no es la App apagada): se sigue con las demás y se avisa', async () => {
    ahora('2026-10-10T08:00:00.000Z');
    const { run, gateway } = readHarness();
    gateway.accessLogs = [
      acceso({
        id: 'a1',
        fecha: '2026-10-10T07:00:00.000Z',
        locationId: 'loc-norte',
        persona: 'Luis',
      }),
    ];
    const original = gateway.listAccessLogs.bind(gateway);
    gateway.listAccessLogs = async (q, t) => {
      if (q.locationId === 'loc-central') {
        throw new PatrolTechApiError(403, '/x', {
          success: false,
          message: 'Insufficient permissions',
        });
      }
      return original(q, t);
    };

    const out = await run('consultar_accesos');

    expect(out).toMatchObject({ ok: true, data: { total: 1 } });
    expect(out.avisos?.join(' ')).toMatch(/1 ubicación\(es\) no se pudieron consultar/);
  });

  it('un fallo que no es del backend (red) no se traga: la capacidad falla', async () => {
    const { run, gateway } = readHarness();
    gateway.listAccessLogs = () => Promise.reject(new TypeError('fetch failed'));
    expect((await run('consultar_accesos')).ok).toBe(false);
  });

  it('organización sin ubicaciones → total 0 sin consultar nada', async () => {
    const { run, gateway } = readHarness();
    gateway.locations = [];
    const out = await run('consultar_accesos');
    expect(out).toMatchObject({
      ok: true,
      data: { total: 0, entradas: 0, salidas: 0, ultimos: [] },
    });
    expect(gateway.accessLogQueries).toEqual([]);
  });

  it('más de 20 ubicaciones: consulta 20 y avisa de que pida la ubicación', async () => {
    const { run, gateway } = readHarness();
    gateway.locations = Array.from({ length: 23 }, (_, i) => ({
      id: `loc-${i}`,
      name: `Ubicación ${i}`,
    }));
    const out = await run('consultar_accesos', { tipo: 'entrada' });
    expect(new Set(gateway.accessLogQueries.map((q) => q.locationId)).size).toBe(20);
    expect(out.avisos?.join(' ')).toMatch(/23 ubicaciones/);
  });

  it('solo salidas: una consulta por ubicación (sin la de contar entradas) y entradas = 0', async () => {
    ahora('2026-10-10T08:00:00.000Z');
    const { run, gateway } = readHarness();
    gateway.accessLogs = [
      acceso({ id: 'a1', fecha: '2026-10-10T07:00:00.000Z', tipo: 'EXIT', persona: 'Luis' }),
    ];
    const out = await run('consultar_accesos', { tipo: 'salida', ubicacion: 'central' });
    expect(gateway.accessLogQueries).toHaveLength(1);
    expect(out.data).toMatchObject({ total: 1, entradas: 0, salidas: 1 });
  });

  it('«hoy» en México empieza a medianoche de MÉXICO, no de Madrid', async () => {
    ahora('2026-10-10T04:00:00.000Z'); // 9-oct 22:00 en CDMX
    const { run, gateway } = readHarness({ ctx: { tz: 'America/Mexico_City' } });
    await run('consultar_accesos', { periodo: 'hoy', ubicacion: 'central' });
    expect(gateway.accessLogQueries[0]).toMatchObject({
      desde: '2026-10-09T06:00:00.000Z',
      hasta: '2026-10-10T04:00:00.000Z',
    });
  });

  it('«ayer» el día del cambio de hora en Madrid (25-oct, 25 h) cubre el día local entero', async () => {
    ahora('2026-10-26T10:00:00.000Z');
    const { run, gateway } = readHarness();
    await run('consultar_accesos', { periodo: 'ayer', ubicacion: 'central' });
    expect(gateway.accessLogQueries[0]).toMatchObject({
      desde: '2026-10-24T22:00:00.000Z',
      hasta: '2026-10-25T23:00:00.000Z',
    });
  });

  it('filas ocultas por la retención: «(oculto …)», nunca un nombre ni documento', async () => {
    ahora('2026-10-10T08:00:00.000Z');
    const { run, gateway } = readHarness();
    gateway.accessLogs = [
      acceso({
        id: 'a1',
        fecha: '2026-10-10T07:00:00.000Z',
        oculto: true,
        visitante: 'Ana',
        documentoVisitante: 'X123',
      }),
    ];
    gateway.activeAccessEntries = [gateway.accessLogs[0]];
    const out = await run('consultar_accesos', { ubicacion: 'central' });
    expect((out.data?.ultimos as { quien: string }[])[0].quien).toBe(
      '(oculto por la retención de datos)'
    );
    const dentro = await run('consultar_accesos', { ubicacion: 'central', solo_dentro: true });
    expect(JSON.stringify(dentro)).not.toContain('X123');
    expect(JSON.stringify(dentro)).not.toContain('Ana');
  });

  it('«quién está dentro»: las entradas sin salida de hace más de 24 h van aparte, no como dentro ahora', async () => {
    ahora('2026-10-10T08:00:00.000Z');
    const { run, gateway } = readHarness();
    gateway.activeAccessEntries = [
      acceso({ id: 'hoy', fecha: '2026-10-10T07:00:00.000Z', persona: 'Luis' }),
      acceso({ id: 'feb', fecha: '2026-02-03T09:00:00.000Z', persona: 'Olvidado' }),
      acceso({ id: 'mar', fecha: '2026-03-15T09:00:00.000Z', persona: 'Otro' }),
    ];
    const out = await run('consultar_accesos', { solo_dentro: true, ubicacion: 'central' });
    expect(out.data).toMatchObject({ dentroAhora: 1, sinSalidaRegistrada: 2 });
    expect((out.data?.personas as { quien: string }[]).map((p) => p.quien)).toEqual(['Luis']);
    expect((out.data?.entradasSinSalida as { quien: string }[]).map((p) => p.quien)).toEqual([
      'Otro',
      'Olvidado',
    ]);
    expect(out.avisos?.join(' ')).toMatch(/2 entrada\(s\) de hace más de 24 h.*2026-02-03/);
  });

  it('«quién está dentro» sin entradas antiguas: ni campo ni aviso extra', async () => {
    ahora('2026-10-10T08:00:00.000Z');
    const { run, gateway } = readHarness();
    gateway.activeAccessEntries = [
      acceso({ id: 'hoy', fecha: '2026-10-10T07:00:00.000Z', persona: 'Luis' }),
    ];
    const out = await run('consultar_accesos', { solo_dentro: true, ubicacion: 'central' });
    expect(out.data).not.toHaveProperty('sinSalidaRegistrada');
    expect(out.avisos ?? []).toEqual([]);
  });

  it('zona que no existe → total 0 y avisa de escribirla como en el panel', async () => {
    const { run } = readHarness();
    const out = await run('consultar_accesos', { zona: 'porteria' });
    expect(out.avisos?.join(' ')).toMatch(/como en el panel/);
  });

  it('ubicación ambigua → pregunta cuál', async () => {
    const { run, gateway } = readHarness();
    gateway.locations.push({ id: 'loc-sur', name: 'Sucursal Sur' });
    expect(await run('consultar_accesos', { ubicacion: 'sucursal' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/ambigua/) as unknown,
    });
  });
});
