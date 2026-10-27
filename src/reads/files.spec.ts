import { describe, it, expect } from 'vitest';
import { PatrolTechApiError } from '../domain/backend-errors.js';
import type { AccessLogEntry, RecentScan } from '../gateway/index.js';
import { RecordingFileSink, readHarness } from '../testing/index.js';
import { SIN_FICHEROS } from './files.js';

/** El CSV tal cual (con su BOM) para comparar líneas. */
const texto = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

describe('enviar_qr_checkpoint', () => {
  it('genera el PNG del QR y lo envía al cliente con nombre y código al pie', async () => {
    const { run, files } = readHarness();

    const out = await run('enviar_qr_checkpoint', { checkpoint: 'entrada' });

    expect(out).toEqual({
      ok: true,
      data: { enviado: true, nombre: 'Entrada principal', codigo: 'PT-ENTRADA01' },
    });
    expect(files?.images).toHaveLength(1);
    const { png, caption } = files!.images[0];
    expect(Buffer.from(png).subarray(0, 4).toString('hex')).toBe('89504e47'); // cabecera PNG
    expect(caption).toBe('Entrada principal\nPT-ENTRADA01');
  });

  it('sin código visible (no es Editor de esa ubicación): no envía nada y explica que lo pida un editor', async () => {
    const { run, files } = readHarness();

    const out = await run('enviar_qr_checkpoint', { checkpoint: 'Recepción' });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Editor o Admin de la ubicación «Sucursal Norte»/);
    expect(files?.images).toEqual([]);
  });

  it('código manual: devuelve el código para darlo en texto, sin imagen', async () => {
    const { run, files } = readHarness();

    const out = await run('enviar_qr_checkpoint', { checkpoint: 'Almacén' });

    expect(out).toMatchObject({
      ok: true,
      data: { enviado: false, metodo: 'codigo_manual', codigo: 'ALM-1234' },
    });
    expect(files?.images).toEqual([]);
  });

  it('checkpoint NFC: no hay QR que enviar', async () => {
    const { run, gateway, files } = readHarness();
    gateway.checkpointRefs.push({
      id: 'cp-nfc',
      name: 'Sótano',
      locationId: 'loc-central',
      locationName: 'Sede Central',
      metodo: 'nfc_sun',
      codigo: null,
    });

    const out = await run('enviar_qr_checkpoint', { checkpoint: 'Sótano' });

    expect(out.ok).toBe(false);
    expect(out.error).toContain('nfc_sun');
    expect(files?.images).toEqual([]);
  });

  it('mismo nombre en dos ubicaciones: pregunta, y con la ubicación lo resuelve', async () => {
    const { run, gateway, files } = readHarness();
    gateway.checkpointRefs.push({
      id: 'cp-entrada-n',
      name: 'Entrada principal',
      locationId: 'loc-norte',
      locationName: 'Sucursal Norte',
      metodo: 'qr_static',
      codigo: 'PT-ENTRADA02',
    });

    const ambigua = await run('enviar_qr_checkpoint', { checkpoint: 'Entrada principal' });
    expect(ambigua.ok).toBe(false);
    expect(ambigua.opciones).toEqual([
      'Entrada principal (Sede Central)',
      'Entrada principal (Sucursal Norte)',
    ]);
    expect(files?.images).toEqual([]);

    const out = await run('enviar_qr_checkpoint', {
      checkpoint: 'Entrada principal',
      ubicacion: 'Norte',
    });
    expect(out).toMatchObject({ ok: true, data: { codigo: 'PT-ENTRADA02' } });
  });

  it('enviar_qr_checkpoint devuelve también el identificador', async () => {
    const { run, gateway } = readHarness();
    gateway.checkpointRefs[0] = { ...gateway.checkpointRefs[0], identificador: '7F3A9C21' };

    const out = await run('enviar_qr_checkpoint', { checkpoint: 'entrada' });

    expect(out).toEqual({
      ok: true,
      data: {
        enviado: true,
        nombre: 'Entrada principal',
        codigo: 'PT-ENTRADA01',
        identificador: '7F3A9C21',
      },
    });
  });

  it('sin offerFiles, las capacidades que envían ficheros no existen', () => {
    const { reads } = readHarness({ withFiles: false });
    const nombres = reads.map((r) => r.name);
    expect(nombres).not.toContain('enviar_qr_checkpoint');
    expect(nombres).not.toContain('enviar_excel_escaneos');
    expect(nombres).not.toContain('enviar_excel_accesos');
    expect(nombres).toHaveLength(22);
  });
});

describe('enviar_excel_escaneos', () => {
  const muchos = (n: number): RecentScan[] =>
    Array.from({ length: n }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 6, 29, 8) - i * 60_000).toISOString(),
      checkpointName: 'Entrada principal',
      patrollerName: 'Juan Pérez',
      fraudFlagged: false,
      validacion: 'válido',
      motivosSospecha: [],
    }));

  it('envía el CSV como documento con filtros resueltos, rango en el calendario del cliente y la ubicación del checkpoint', async () => {
    const { run, gateway, files } = readHarness();

    const out = await run('enviar_excel_escaneos', {
      desde: '2026-07-01',
      hasta: '2026-07-31',
      vigilante: 'juan',
      solo_sospechosos: true,
    });

    expect(out).toMatchObject({
      ok: true,
      data: { enviado: true, filas: 2, periodo: { desde: '2026-07-01', hasta: '2026-07-31' } },
    });
    expect(gateway.scanOpts.at(-1)).toMatchObject({
      patrollerId: 'p-juan',
      soloSospechosos: true,
      page: 1,
      limit: 100,
      dateFrom: '2026-06-30T22:00:00.000Z',
      dateTo: '2026-07-31T22:00:00.000Z',
    });
    const doc = files!.documents[0];
    expect(doc).toMatchObject({
      filename: 'escaneos_2026-07-01_2026-07-31.csv',
      mimeType: 'text/csv',
    });
    expect(doc.caption).toMatch(/Excel/);
    const lineas = texto(doc.bytes).split('\r\n');
    expect(lineas[1]).toBe(
      '2026-07-29 10:00:00;Juan Pérez;Entrada principal;Sede Central;válido: es un escaneo auténtico de un punto real;no;;;'
    );
  });

  it('pagina el backend hasta el tope de 2.000 filas y avisa de que hay más', async () => {
    const { run, gateway, files } = readHarness();
    gateway.scans = muchos(2050);

    const out = await run('enviar_excel_escaneos', { desde: '2026-07-01', hasta: '2026-07-31' });

    expect(out).toMatchObject({ ok: true, truncado: true, data: { filas: 2000 } });
    expect(out.avisos?.[0]).toMatch(/2000 escaneos más recientes/);
    expect(gateway.scanOpts.map((o) => o?.page)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1)
    );
    expect(texto(files!.documents[0].bytes).split('\r\n')).toHaveLength(2002);
  });

  it('para en la última página sin avisar de truncado', async () => {
    const { run, gateway } = readHarness();
    gateway.scans = muchos(150);

    const out = await run('enviar_excel_escaneos', { desde: '2026-07-01', hasta: '2026-07-31' });

    expect(out).toMatchObject({ ok: true, data: { filas: 150 } });
    expect(out.truncado).toBeUndefined();
    expect(gateway.scanOpts).toHaveLength(2);
  });

  it('más de 31 días o fechas invertidas: error claro y no consulta', async () => {
    const { run, gateway, files } = readHarness();

    const largo = await run('enviar_excel_escaneos', { desde: '2026-07-01', hasta: '2026-08-01' });
    const invertido = await run('enviar_excel_escaneos', {
      desde: '2026-07-10',
      hasta: '2026-07-01',
    });

    expect(largo.error).toMatch(/31 días/);
    expect(invertido.error).toMatch(/posterior/);
    expect(gateway.scanOpts).toHaveLength(0);
    expect(files?.documents).toEqual([]);
  });

  it('sin escaneos no envía un fichero vacío', async () => {
    const { run, gateway, files } = readHarness();
    gateway.scans = [];

    const out = await run('enviar_excel_escaneos', { desde: '2026-07-01', hasta: '2026-07-02' });

    expect(out).toMatchObject({ ok: true, data: { enviado: false, filas: 0 } });
    expect(files?.documents).toEqual([]);
  });

  it('sin offerFiles no se ofrece', () => {
    const { reads } = readHarness({ withFiles: false });
    expect(reads.map((r) => r.name)).not.toContain('enviar_excel_escaneos');
  });
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

describe('enviar_excel_accesos (B3)', () => {
  it('envía el CSV con todos los campos del panel (también el documento del visitante)', async () => {
    const { run, gateway, files } = readHarness();
    gateway.accessLogs = ACCESOS;

    const out = await run('enviar_excel_accesos', { desde: '2026-10-01', hasta: '2026-10-10' });

    expect(out).toMatchObject({ ok: true, data: { enviado: true, filas: 4 } });
    const doc = files!.documents[0];
    expect(doc).toMatchObject({
      filename: 'accesos_2026-10-01_2026-10-10.csv',
      mimeType: 'text/csv',
    });
    const lineas = texto(doc.bytes).split('\r\n');
    expect(lineas[0]).toBe(
      '﻿Fecha y hora;Tipo;Ubicación;Zona;Persona autorizada;Identificador;Visitante;Documento;Empresa;Destino;Notas'
    );
    expect(lineas[2]).toBe(
      '2026-10-10 08:30:00;Salida;Sede Central;;;;Ana Sanz;12345678Z;Limpiezas SA;;'
    );
  });

  it('rechaza periodos de más de 31 días', async () => {
    const { run } = readHarness();

    const out = await run('enviar_excel_accesos', { desde: '2026-08-01', hasta: '2026-10-10' });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/31 días/);
  });

  it('sin offerFiles no se registra', () => {
    const { reads } = readHarness({ withFiles: false });
    expect(reads.map((r) => r.name)).not.toContain('enviar_excel_accesos');
  });
});

describe('enviar_excel_accesos: casos límite', () => {
  const muchos = (n: number, locationId = 'loc-central'): AccessLogEntry[] =>
    Array.from({ length: n }, (_, i) =>
      acceso({
        id: `${locationId}-${i}`,
        locationId,
        fecha: new Date(Date.parse('2026-10-09T12:00:00.000Z') - i * 1000).toISOString(),
      })
    );

  it('justo 2000 registros en total: NO dice que hay más', async () => {
    const { run, gateway } = readHarness();
    gateway.accessLogs = muchos(2000);
    const out = await run('enviar_excel_accesos', { desde: '2026-10-01', hasta: '2026-10-10' });
    expect(out).toMatchObject({ ok: true, data: { enviado: true, filas: 2000 } });
    expect(out.truncado).toBeFalsy();
  });

  it('2000 en la primera ubicación y alguno más en la segunda: corta en 2000 y avisa', async () => {
    const { run, gateway } = readHarness();
    gateway.accessLogs = [...muchos(2000), ...muchos(3, 'loc-norte')];
    const out = await run('enviar_excel_accesos', { desde: '2026-10-01', hasta: '2026-10-10' });
    expect(out).toMatchObject({ ok: true, data: { filas: 2000 }, truncado: true });
    expect(out.avisos?.join(' ')).toMatch(/2000 registros y hay más/);
  });

  it('una sola ubicación con 2050: corta en 2000 y avisa', async () => {
    const { run, gateway } = readHarness();
    gateway.accessLogs = muchos(2050);
    const out = await run('enviar_excel_accesos', {
      desde: '2026-10-01',
      hasta: '2026-10-10',
      ubicacion: 'central',
    });
    expect(out).toMatchObject({ ok: true, data: { filas: 2000 }, truncado: true });
  });

  it('«desde» posterior a «hasta» → error, sin consultar', async () => {
    const { run, gateway } = readHarness();
    expect(
      await run('enviar_excel_accesos', { desde: '2026-10-10', hasta: '2026-10-01' })
    ).toMatchObject({ ok: false });
    expect(gateway.accessLogQueries).toEqual([]);
  });

  it('App apagada → lo explica y no envía nada', async () => {
    const { run, gateway, files } = readHarness();
    gateway.accessLogsError = new PatrolTechApiError(403, '/x', {
      success: false,
      message: "Feature 'access-control' is not enabled",
    });
    expect(
      await run('enviar_excel_accesos', { desde: '2026-10-01', hasta: '2026-10-10' })
    ).toMatchObject({ ok: false, error: expect.stringMatching(/Control de Acceso/) as unknown });
    expect(files?.documents).toEqual([]);
  });

  it('sin registros → no envía fichero vacío', async () => {
    const { run, files } = readHarness();
    expect(
      await run('enviar_excel_accesos', { desde: '2026-10-01', hasta: '2026-10-10' })
    ).toMatchObject({ ok: true, data: { enviado: false, filas: 0 } });
    expect(files?.documents).toEqual([]);
  });
});

describe('ficheros por llamada (`ctx.files`)', () => {
  it('cada llamada deja el fichero en SU FileSink: dos usuarios a la vez no se cruzan', async () => {
    const { run, ctx } = readHarness({ withFiles: true });
    const deAna = new RecordingFileSink();
    const deLuis = new RecordingFileSink();

    await Promise.all([
      run('enviar_qr_checkpoint', { checkpoint: 'entrada' }, { ...ctx, files: deAna }),
      run('enviar_qr_checkpoint', { checkpoint: 'entrada' }, { ...ctx, files: deLuis }),
    ]);

    expect(deAna.images).toHaveLength(1);
    expect(deLuis.images).toHaveLength(1);
    expect(ctx.files).toBeInstanceOf(RecordingFileSink);
    expect((ctx.files as RecordingFileSink).images).toEqual([]);
  });

  it.each([
    ['enviar_qr_checkpoint', { checkpoint: 'entrada' }],
    ['enviar_excel_escaneos', { desde: '2026-07-01', hasta: '2026-07-29' }],
    ['enviar_excel_accesos', { desde: '2026-07-01', hasta: '2026-07-29' }],
  ])(
    '%s ofrecida pero llamada sin `ctx.files`: error claro y ninguna consulta',
    async (name, args) => {
      const { run, ctx, gateway } = readHarness();

      const out = await run(name, args, { ...ctx, files: undefined });

      expect(out).toEqual({ ok: false, error: SIN_FICHEROS });
      expect(gateway.calls).toEqual([]);
    }
  );
});
