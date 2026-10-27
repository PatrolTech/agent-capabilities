/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/require-await -- stubs de fetch portados del bot: la URL y el cuerpo que reciben son siempre strings y los stubs son async sin await */
import { describe, it, expect, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';

const apiBase = 'http://api.test';

/** El backend responde `application/json`: el SDK solo parsea JSON con esa cabecera (el bot lo hacía a ciegas). */
const apiResponse = (body: BodyInit | null, init?: ResponseInit): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/json' } });

/** fetch falso que devuelve, en orden, los cuerpos (ya con su envelope); apunta método, ruta y cuerpo. */
function fakeFetch(...responses: unknown[]) {
  const f = vi.fn<typeof fetch>(async () => {
    const data = responses.length ? responses.shift() : {};
    return apiResponse(JSON.stringify({ success: true, message: 'OK', data, meta: {} }), {
      status: 200,
    });
  });
  const calls = () =>
    f.mock.calls.map(([u, init]) => ({
      method: init?.method,
      path: String(u).slice(apiBase.length),
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    }));
  return { f, calls };
}

const cp = (extra: Record<string, unknown>) => ({
  id: 'c1',
  name: 'Entrada',
  locationId: 'l1',
  verificationMethod: { type: 'qr_static' },
  ...extra,
});

describe('SdkPatrolTechGateway — antifraude y posición del checkpoint', () => {
  it('getCheckpointDetail: busca en su ubicación por nombre y devuelve coordenadas y reglas', async () => {
    const { f, calls } = fakeFetch({
      results: [
        cp({ id: 'c0', name: 'Entrada trasera' }),
        cp({
          latitude: 40.4,
          longitude: -3.7,
          fraudRules: {
            gpsProximity: { maxDistanceMeters: 30, maxAccuracyMeters: 50 },
            undergroundMode: { enabled: true },
          },
        }),
      ],
      count: 2,
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const d = await client.getCheckpointDetail(
      { id: 'c1', locationId: 'l1', name: 'Entrada' },
      'jwt'
    );

    expect(calls()[0]).toEqual({
      method: 'GET',
      path: '/api/checkpoints?locationId=l1&search=Entrada&limit=100',
      body: undefined,
    });
    expect(d).toEqual({
      id: 'c1',
      name: 'Entrada',
      locationId: 'l1',
      metodo: 'qr_static',
      latitud: 40.4,
      longitud: -3.7,
      reglasAntifraude: {
        gpsProximity: { maxDistanceMeters: 30, maxAccuracyMeters: 50 },
        undergroundMode: { enabled: true },
      },
      reglasDesconocidas: [],
    });
  });

  it('getCheckpointDetail: sin coordenadas ni reglas (o reglas como texto JSON), y null si no está', async () => {
    const { f } = fakeFetch(
      { results: [cp({ latitude: null, longitude: null, fraudRules: null })], count: 1 },
      {
        results: [cp({ fraudRules: '{"undergroundMode":{"enabled":false},"wifiCheck":{"x":1}}' })],
        count: 1,
      },
      { results: [], count: 0 }
    );
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });
    const input = { id: 'c1', locationId: 'l1', name: 'Entrada' };

    expect(await client.getCheckpointDetail(input, 'jwt')).toMatchObject({
      latitud: null,
      longitud: null,
      reglasAntifraude: {},
      reglasDesconocidas: [],
    });
    // Una regla que el bot no conoce no se pierde en silencio: se informa para no reescribirla.
    expect(await client.getCheckpointDetail(input, 'jwt')).toMatchObject({
      reglasAntifraude: { undergroundMode: { enabled: false } },
      reglasDesconocidas: ['wifiCheck'],
    });
    expect(await client.getCheckpointDetail(input, 'jwt')).toBeNull();
  });

  it('updateCheckpointFraudRules y moveCheckpoint: PUT solo con su campo', async () => {
    const { f, calls } = fakeFetch({}, {}, {});
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    await client.updateCheckpointFraudRules(
      { id: 'c1', fraudRules: { gpsProximity: { maxDistanceMeters: 100 } } },
      'jwt'
    );
    await client.updateCheckpointFraudRules({ id: 'c1', fraudRules: null }, 'jwt');
    await client.moveCheckpoint({ id: 'c1', latitude: 40.41, longitude: -3.71 }, 'jwt');

    expect(calls()).toEqual([
      {
        method: 'PUT',
        path: '/api/checkpoints/c1',
        body: { fraudRules: { gpsProximity: { maxDistanceMeters: 100 } } },
      },
      { method: 'PUT', path: '/api/checkpoints/c1', body: { fraudRules: null } },
      { method: 'PUT', path: '/api/checkpoints/c1', body: { latitude: 40.41, longitude: -3.71 } },
    ]);
  });
});
