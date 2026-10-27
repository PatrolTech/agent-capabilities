/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/require-await -- stubs de fetch portados del bot: la URL y el cuerpo que reciben son siempre strings y los stubs son async sin await */
import { describe, it, expect, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';

const apiBase = 'http://api.test';

/** El backend responde `application/json`: el SDK solo parsea JSON con esa cabecera (el bot lo hacía a ciegas). */
const apiResponse = (body: BodyInit | null, init?: ResponseInit): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/json' } });

/** fetch falso que responde por prefijo de ruta y apunta las URLs pedidas. */
function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input).slice(apiBase.length);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) return new Response('not found', { status: 404 });
    return apiResponse(
      JSON.stringify({ success: true, message: 'OK', data: routes[key], meta: {} }),
      { status: 200 }
    );
  });
}

const urls = (f: ReturnType<typeof fakeFetch>): string[] =>
  f.mock.calls.map(([u]) => String(u).slice(apiBase.length));

describe('SdkPatrolTechGateway — lecturas básicas', () => {
  it('getRecentScans: pasa los filtros a /api/scans con los nombres de parámetro del backend', async () => {
    const f = fakeFetch({ '/api/scans': { results: [], count: 0, totalPages: 0 } });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    await client.getRecentScans('org1', 'jwt', {
      limit: 100,
      patrollerId: 'p1',
      checkpointId: 'c1',
      locationId: 'l1',
      soloSospechosos: true,
      soloNoValidos: true,
    });

    expect(urls(f)).toEqual([
      '/api/scans?organizationId=org1&limit=100&patroller=p1&checkpoint=c1&locationId=l1&fraudStatus=flagged&validationStatus=rejected',
    ]);
  });

  it('getRecentScans: añade dispositivo y distancia/precisión GPS cuando vienen, y nada cuando no', async () => {
    const f = fakeFetch({
      '/api/scans': {
        results: [
          {
            timestamp: '2026-07-29T08:00:00Z',
            checkpointName: 'Entrada',
            patrollerName: 'Juan',
            deviceInfo: {
              deviceName: 'SM-A515F',
              platform: 'android',
              osVersion: '13',
              manufacturer: 'samsung',
              batteryLevel: 49.000000953674316,
              batteryStatus: 'charging',
              connectionType: 'wifi',
              connectionDownlink: 10,
            },
            location: null,
            fraudFlags: {
              flagged: true,
              gpsProximity: {
                status: 'fail',
                distanceMeters: 212.4,
                accuracyMeters: 8.7,
                effectiveDistanceMeters: 203.7,
              },
            },
            validationStatus: 'verified',
            validationReason: null,
            redacted: false,
          },
          {
            timestamp: '2026-07-29T07:00:00Z',
            checkpointName: 'Almacén',
            patrollerName: 'Ana',
            deviceInfo: null,
            location: null,
            fraudFlags: null,
            validationStatus: 'rejected',
            validationReason: 'uid_mismatch',
            redacted: false,
          },
        ],
        count: 2,
        totalPages: 1,
      },
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const { items } = await client.getRecentScans('org1', 'jwt');

    expect(items[0]).toMatchObject({
      dispositivo: {
        modelo: 'samsung SM-A515F',
        sistema: 'android 13',
        bateriaPct: 49,
        cargando: true,
        conexion: 'wifi',
      },
      distanciaGpsM: 212,
      precisionGpsM: 9,
      motivosSospecha: [expect.stringContaining('GPS')],
    });
    expect(items[1]).not.toHaveProperty('dispositivo');
    expect(items[1]).not.toHaveProperty('distanciaGpsM');
    expect(items[1].validacion).toContain('el UID de la etiqueta no coincide');
  });

  // Forma real de la API: /api/locations devuelve `data` como array plano,
  // sin `results`. Con la forma paginada supuesta, listLocations y todo lo que cuelga de las
  // ubicaciones (checkpoints, rutas, Excel) fallaba con "reading 'map'/'slice' of undefined".
  it('listLocations y listCheckpoints aceptan /api/locations como array plano', async () => {
    const f = fakeFetch({
      '/api/locations': [{ id: 'l1', name: 'Sede' }],
      '/api/checkpoints': {
        results: [
          {
            id: 'c1',
            name: 'Entrada',
            locationId: 'l1',
            archivedAt: null,
            verificationMethod: null,
          },
        ],
        count: 1,
        totalPages: 1,
      },
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    expect(await client.listLocations('org1', 'jwt')).toEqual([
      { id: 'l1', name: 'Sede', address: null },
    ]);
    const { items, truncado } = await client.listCheckpoints('org1', 'jwt');
    expect(items).toEqual([
      {
        id: 'c1',
        name: 'Entrada',
        locationId: 'l1',
        locationName: 'Sede',
        metodo: null,
        codigo: null,
      },
    ]);
    expect(truncado).toBe(false);
  });

  it('una ubicación sin nombre (name: null) se llama «Ubicación principal»', async () => {
    const f = fakeFetch({
      '/api/locations': [{ id: 'l1', name: null }],
      '/api/checkpoints': {
        results: [
          {
            id: 'c1',
            name: 'Entrada',
            locationId: 'l1',
            archivedAt: null,
            verificationMethod: null,
          },
        ],
        count: 1,
        totalPages: 1,
      },
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    expect(await client.listLocations('org1', 'jwt')).toEqual([
      { id: 'l1', name: 'Ubicación principal', address: null },
    ]);
    expect((await client.listCheckpoints('org1', 'jwt')).items[0].locationName).toBe(
      'Ubicación principal'
    );
  });

  it('listCheckpoints: el código solo cuando viene en claro; `[redacted]` (VIEWER) es null', async () => {
    const f = fakeFetch({
      '/api/locations': { results: [{ id: 'l1', name: 'Sede' }], count: 1, totalPages: 1 },
      '/api/checkpoints': {
        results: [
          {
            id: 'c1',
            name: 'Entrada',
            locationId: 'l1',
            archivedAt: null,
            verificationMethod: { type: 'qr_static', config: { code: 'PT-AAAA' } },
          },
          {
            id: 'c2',
            name: 'Almacén',
            locationId: 'l1',
            archivedAt: null,
            verificationMethod: { type: 'qr_static', config: { code: '[redacted]' } },
          },
          {
            id: 'c3',
            name: 'Sótano',
            locationId: 'l1',
            archivedAt: null,
            verificationMethod: null,
          },
          {
            id: 'c4',
            name: 'Viejo',
            locationId: 'l1',
            archivedAt: '2026-01-01T00:00:00Z',
            verificationMethod: null,
          },
        ],
        count: 4,
        totalPages: 1,
      },
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const { items } = await client.listCheckpoints('org1', 'jwt');

    expect(items).toEqual([
      {
        id: 'c1',
        name: 'Entrada',
        locationId: 'l1',
        locationName: 'Sede',
        metodo: 'qr_static',
        codigo: 'PT-AAAA',
      },
      {
        id: 'c2',
        name: 'Almacén',
        locationId: 'l1',
        locationName: 'Sede',
        metodo: 'qr_static',
        codigo: null,
      },
      {
        id: 'c3',
        name: 'Sótano',
        locationId: 'l1',
        locationName: 'Sede',
        metodo: null,
        codigo: null,
      },
    ]);
  });

  it('listPatrollers: conserva id e identifier', async () => {
    const f = fakeFetch({
      '/api/patrollers': {
        results: [
          {
            id: 'p1',
            name: 'Juan',
            identifier: '89FAD411',
            organizationId: 'org1',
            lastScanDate: null,
            status: 'alert',
          },
        ],
        count: 1,
        totalPages: 1,
      },
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const result = await client.listPatrollers('org1', 'jwt');

    expect(result.items).toEqual([
      { id: 'p1', name: 'Juan', identifier: '89FAD411', lastScanAt: null },
    ]);
    expect(urls(f)).toEqual(['/api/patrollers?organizationId=org1&limit=100']);
  });

  it('getRouteRounds pide la página y getRoundDetail el desglose por checkpoint de ESA ronda', async () => {
    const f = fakeFetch({
      '/api/routes/r1/rounds/rd1/checkpoints': {
        roundId: 'rd1',
        routeId: 'r1',
        status: 'incomplete',
        scannedCount: 1,
        totalCount: 2,
        checkpoints: [
          {
            checkpointId: 'c1',
            checkpointName: 'Entrada',
            order: 1,
            scanned: true,
            scanTime: '2026-07-29T21:05:00Z',
          },
          {
            checkpointId: 'c2',
            checkpointName: 'Azotea',
            order: 2,
            scanned: false,
            scanTime: null,
          },
        ],
      },
      '/api/routes/r1/rounds': {
        results: [
          {
            id: 'rd1',
            routeId: 'r1',
            patrollerName: 'Juan',
            startTime: '2026-07-29T21:00:00Z',
            endTime: null,
            status: 'in_progress',
            completedCheckpoints: 1,
            totalCheckpoints: 2,
          },
        ],
        count: 51,
        totalPages: 2,
      },
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const page = await client.getRouteRounds('r1', 'jwt', { page: 2, limit: 50 });
    const detail = await client.getRoundDetail('r1', 'rd1', 'jwt');

    expect(page).toEqual({
      totalPages: 2,
      items: [
        {
          id: 'rd1',
          status: 'in_progress',
          patrollerName: 'Juan',
          completedCheckpoints: 1,
          totalCheckpoints: 2,
          startTime: '2026-07-29T21:00:00Z',
          endTime: null,
        },
      ],
    });
    expect(detail).toMatchObject({ status: 'incomplete', scannedCount: 1, totalCount: 2 });
    expect(urls(f)).toEqual([
      '/api/routes/r1/rounds?page=2&limit=50',
      '/api/routes/r1/rounds/rd1/checkpoints',
    ]);
  });

  it('getPlanUsage: plan, estado y uso; -1 y null son «sin tope»', async () => {
    const f = fakeFetch({
      '/api/licenses/organization/org1': {
        license: { id: 'lic', status: 'active' },
        tier: { name: 'Pro', limits: {} },
        usage: {
          checkpoints: { used: 12, included: 10, extra: 2 },
          locations: { used: 2, limit: -1 },
          managers: { used: 3, limit: null },
        },
      },
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const usage = await client.getPlanUsage('org1', 'jwt');

    expect(usage).toEqual({
      plan: 'Pro',
      estadoLicencia: 'active',
      pagaSuscripcion: null,
      uso: {
        checkpoints: { usados: 12, incluidos: 10, extraFacturados: 2 },
        ubicaciones: { usadas: 2, limite: null },
        gestores: { usados: 3, limite: null },
      },
    });
  });
});
