/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/require-await -- stubs de fetch portados del bot: la URL y el cuerpo que reciben son siempre strings y los stubs son async sin await */
import { describe, it, expect, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';

const apiBase = 'http://api.test';

/** El backend responde `application/json`: el SDK solo parsea JSON con esa cabecera (el bot lo hacía a ciegas). */
const apiResponse = (body: BodyInit | null, init?: ResponseInit): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/json' } });

/** fetch falso con una respuesta fija; apunta método, ruta y cuerpo de cada llamada. */
function fakeFetch(status: number, body: unknown) {
  const f = vi.fn<typeof fetch>(async () => apiResponse(JSON.stringify(body), { status }));
  const calls = () =>
    f.mock.calls.map(([u, init]) => ({
      method: init?.method,
      path: String(u).slice(apiBase.length),
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      contentType: (init?.headers as Record<string, string> | undefined)?.['Content-Type'],
    }));
  return { f, calls };
}

describe('SdkPatrolTechGateway — escrituras básicas', () => {
  it('createCheckpoint: POST con el payload mínimo del panel, código vacío y SIN confirmExtraBilling', async () => {
    const { f, calls } = fakeFetch(201, {
      id: 'cp1',
      name: 'Entrada',
      locationId: 'loc1',
      createdAt: '2026-09-26T10:00:00.000Z',
      verificationMethod: { type: 'qr_static', config: { code: 'PT-7K3QX2M9LA' } },
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const cp = await client.createCheckpoint(
      { name: 'Entrada', locationId: 'loc1', metodo: 'qr_static' },
      'jwt'
    );

    expect(calls()).toEqual([
      {
        method: 'POST',
        path: '/api/checkpoints',
        contentType: 'application/json',
        body: {
          name: 'Entrada',
          locationId: 'loc1',
          category: '',
          verificationMethod: { type: 'qr_static', config: {} },
        },
      },
    ]);
    expect(JSON.stringify(calls()[0].body)).not.toContain('confirmExtraBilling');
    expect(cp).toEqual({
      id: 'cp1',
      name: 'Entrada',
      locationId: 'loc1',
      metodo: 'qr_static',
      codigo: 'PT-7K3QX2M9LA',
      creadoEn: '2026-09-26T10:00:00.000Z',
    });
  });

  it('findCheckpointsByName: busca en la ubicación por nombre y trae la fecha de alta', async () => {
    const { f, calls } = fakeFetch(200, {
      results: [
        {
          id: 'cp1',
          name: 'Entrada',
          locationId: 'loc1',
          createdAt: '2026-09-26T10:00:00.000Z',
          verificationMethod: { type: 'manual_code', config: { code: '[redacted]' } },
        },
      ],
      count: 1,
      totalPages: 1,
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const found = await client.findCheckpointsByName('loc1', 'Entrada principal', 'jwt');

    // URLSearchParams del SDK: espacio como `+`, el mismo valor para el backend.
    expect(calls()[0]).toMatchObject({
      method: 'GET',
      path: '/api/checkpoints?locationId=loc1&search=Entrada+principal&limit=100',
    });
    expect(found).toEqual([
      {
        id: 'cp1',
        name: 'Entrada',
        locationId: 'loc1',
        metodo: 'manual_code',
        codigo: null,
        creadoEn: '2026-09-26T10:00:00.000Z',
      },
    ]);
  });

  it('createPatroller: POST con nombre, organización, identificador y teléfono si viene', async () => {
    const { f, calls } = fakeFetch(201, {
      id: 'p1',
      name: 'Luis',
      identifier: 'ABCDEF12',
      organizationId: 'org1',
      status: 'alert',
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const p = await client.createPatroller(
      { organizationId: 'org1', name: 'Luis', identifier: 'ABCDEF12' },
      'jwt'
    );

    expect(calls()).toEqual([
      {
        method: 'POST',
        path: '/api/patrollers',
        contentType: 'application/json',
        body: { name: 'Luis', organizationId: 'org1', identifier: 'ABCDEF12' },
      },
    ]);
    expect(p).toEqual({ id: 'p1', name: 'Luis', identifier: 'ABCDEF12', organizationId: 'org1' });
  });

  it('getPatrollerByIdentifier: un 404 es «no existe» (null), no un error', async () => {
    const { f, calls } = fakeFetch(404, { success: false, message: 'Patroller not found' });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    expect(await client.getPatrollerByIdentifier('ABCDEF12', 'jwt')).toBeNull();
    expect(calls()[0].path).toBe('/api/patrollers/identifier/ABCDEF12');
  });

  it('setAlertPreference: PATCH solo con ese tipo y canal (el backend fusiona channels con lo guardado)', async () => {
    const { f, calls } = fakeFetch(200, { success: true, data: {} });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    await client.setAlertPreference(
      { tipo: 'suspicious_scan', canal: 'whatsapp', activar: false },
      'jwt'
    );

    expect(calls()).toEqual([
      {
        method: 'PATCH',
        path: '/api/auth/user/preferences',
        contentType: 'application/json',
        body: { notificationPreferences: { channels: { suspicious_scan: { whatsapp: false } } } },
      },
    ]);
  });
});

describe('SdkPatrolTechGateway — rutas y horarios', () => {
  it('getRouteDetails: checkpoints en orden y horarios HH:MM (el backend los da HH:MM:SS); 404 = null', async () => {
    const { f, calls } = fakeFetch(200, {
      success: true,
      data: {
        id: 'r1',
        name: 'Nocturna',
        isActive: true,
        locationId: 'loc1',
        checkpoints: [
          { id: 'rc2', routeId: 'r1', checkpointId: 'cp2', order: 2 },
          { id: 'rc1', routeId: 'r1', checkpointId: 'cp1', order: 1 },
        ],
        timeWindows: [
          {
            id: 'tw1',
            routeId: 'r1',
            startTime: '01:00:00',
            endTime: '02:00:00',
            days: [2, 3],
            timezone: 'America/Bogota',
          },
        ],
      },
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    expect(await client.getRouteDetails('r1', 'jwt')).toEqual({
      id: 'r1',
      name: 'Nocturna',
      isActive: true,
      locationId: 'loc1',
      checkpoints: [
        { checkpointId: 'cp1', order: 1 },
        { checkpointId: 'cp2', order: 2 },
      ],
      timeWindows: [{ id: 'tw1', startTime: '01:00', endTime: '02:00', days: [2, 3] }],
    });
    expect(calls()[0]).toMatchObject({ method: 'GET', path: '/api/routes/r1/details' });

    const notFound = fakeFetch(404, { success: false, message: 'Route not found' });
    expect(
      await new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: notFound.f }).getRouteDetails(
        'r9',
        'jwt'
      )
    ).toBeNull();
  });

  it('createRoute: POST /api/routes/complete con el cuerpo tal cual (id del bot, horarios UTC con su zona)', async () => {
    const { f, calls } = fakeFetch(201, { success: true, data: { id: 'r-bot', name: 'Nocturna' } });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });
    const input = {
      id: 'r-bot',
      name: 'Nocturna',
      organizationId: 'org1',
      locationId: 'loc1',
      requiresOrderedScan: false,
      checkpoints: [{ checkpointId: 'cp1', order: 1 }],
      timeWindows: [
        { startTime: '01:00', endTime: '02:00', days: [2], timezone: 'America/Bogota' },
      ],
      scheduleTimezone: 'America/Bogota',
    };

    expect(await client.createRoute(input, 'jwt')).toEqual({ id: 'r-bot', name: 'Nocturna' });
    expect(calls()).toEqual([
      {
        method: 'POST',
        path: '/api/routes/complete',
        contentType: 'application/json',
        body: input,
      },
    ]);
  });

  it('horarios, activar y checkpoints de la ruta: método, ruta y cuerpo; los 204 sin cuerpo no fallan', async () => {
    const f = vi.fn<typeof fetch>(async (_u, init) =>
      init?.method === 'DELETE'
        ? apiResponse(null, { status: 204 })
        : apiResponse(JSON.stringify({ success: true, data: {} }), { status: 201 })
    );
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    await client.addRouteTimeWindow(
      'r1',
      { startTime: '03:00', endTime: '04:00', days: [1], timezone: 'America/Bogota' },
      'jwt'
    );
    await client.deleteRouteTimeWindow('tw1', 'jwt');
    await client.setRouteActive('r1', false, 'jwt');
    await client.addCheckpointToRoute('r1', 'cp3', 3, 'jwt');
    await client.removeCheckpointFromRoute('r1', 'cp1', 'jwt');

    expect(
      f.mock.calls.map(([u, init]) => [
        init?.method,
        String(u).slice(apiBase.length),
        init?.body ? JSON.parse(String(init.body)) : undefined,
      ])
    ).toEqual([
      [
        'POST',
        '/api/routes/r1/timewindows',
        { startTime: '03:00', endTime: '04:00', days: [1], timezone: 'America/Bogota' },
      ],
      ['DELETE', '/api/routes/timewindows/tw1', undefined],
      ['PATCH', '/api/routes/r1/active', { isActive: false }],
      ['POST', '/api/routes/r1/checkpoints/cp3', { order: 3 }],
      ['DELETE', '/api/routes/r1/checkpoints/cp1', undefined],
    ]);
  });
});
