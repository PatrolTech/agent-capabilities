/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/require-await -- stubs de fetch portados del bot: la URL y el cuerpo que reciben son siempre strings y los stubs son async sin await */
import { describe, it, expect, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';
import { PatrolTechApiError } from '../../domain/backend-errors.js';

const apiBase = 'http://api.test';

/** El backend responde `application/json`: el SDK solo parsea JSON con esa cabecera (el bot lo hacía a ciegas). */
const apiResponse = (body: BodyInit | null, init?: ResponseInit): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/json' } });

describe('SdkPatrolTechGateway', () => {
  describe('getPatrollerActivity', () => {
    it('GET /api/patrollers con organizationId, limit y Bearer; mapea lastScanDate -> lastScanAt', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        apiResponse(
          JSON.stringify({
            success: true,
            message: 'OK',
            data: {
              results: [
                { name: 'Juan', lastScanDate: '2026-07-29T06:45:00Z', status: 'active' },
                { name: 'Ana', lastScanDate: null, status: 'alert' },
              ],
              count: 2,
              totalPages: 1,
            },
            meta: {},
          }),
          { status: 200 }
        )
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getPatrollerActivity('org1', 'jwt');

      expect(result.items).toEqual([
        { name: 'Juan', lastScanAt: '2026-07-29T06:45:00Z', status: 'active' },
        { name: 'Ana', lastScanAt: null, status: 'alert' },
      ]);
      expect(result.truncado).toBe(false);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBase}/api/patrollers?organizationId=org1&limit=100`);
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer jwt');
    });

    it('no-2xx -> lanza (no devuelve datos falsos)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('err', { status: 500 }));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getPatrollerActivity('org1', 'jwt')).rejects.toThrow();
    });

    it('no-2xx -> PatrolTechApiError con el status y el cuerpo (para distinguir el motivo)', async () => {
      const body = {
        success: false,
        message: 'Token expired',
        data: null,
        meta: { code: 'TOKEN_EXPIRED' },
      };
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        apiResponse(JSON.stringify(body), { status: 401 })
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const err = await client.getPatrollerActivity('org1', 'jwt').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(PatrolTechApiError);
      expect(err).toMatchObject({
        status: 401,
        body,
        message: expect.stringContaining('PatrolTech API error 401'),
      });
    });

    it('error de red -> propaga', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        throw new Error('network down');
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getPatrollerActivity('org1', 'jwt')).rejects.toThrow('network down');
    });
  });

  describe('getSupportSummary', () => {
    const rawSummary = {
      rounds: { windowDays: 7, inProgress: 3, completed: 20, incomplete: 5, expired: 2 },
      patrollers: { total: 10, active: 7, inactive: 2, alert: 1 },
      checkpoints: { total: 42 },
      suspiciousScans: { windowDays: 7, flagged: 4 },
    };

    it('GET support-summary con windowDays y Bearer; desenvuelve data', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        apiResponse(JSON.stringify({ success: true, message: 'OK', data: rawSummary, meta: {} }), {
          status: 200,
        })
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getSupportSummary('org1', 'jwt');

      expect(result).toEqual(rawSummary);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBase}/api/organizations/org1/support-summary?windowDays=7`);
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer jwt');
    });

    it('usa el windowDays pasado en vez del default', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        apiResponse(JSON.stringify({ success: true, message: 'OK', data: rawSummary, meta: {} }), {
          status: 200,
        })
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await client.getSupportSummary('org1', 'jwt', 30);

      const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBase}/api/organizations/org1/support-summary?windowDays=30`);
    });

    it('no-2xx -> lanza (no devuelve datos falsos)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('err', { status: 500 }));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getSupportSummary('org1', 'jwt')).rejects.toThrow();
    });

    it('pasa un AbortSignal con timeout al fetch (defensa contra colgarse el worker en value_nudge)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        apiResponse(JSON.stringify({ success: true, message: 'OK', data: rawSummary, meta: {} }), {
          status: 200,
        })
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await client.getSupportSummary('org1', 'jwt');

      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('timeout/abort del fetch (AbortError) -> propaga (no cuelga, no devuelve datos falsos)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getSupportSummary('org1', 'jwt')).rejects.toThrow();
    });
  });

  describe('getRoundsStatus', () => {
    it('usa support-summary (una sola llamada) y mapea incomplete = incomplete+expired', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        apiResponse(
          JSON.stringify({
            success: true,
            message: 'OK',
            data: {
              rounds: { windowDays: 7, inProgress: 1, completed: 2, incomplete: 1, expired: 1 },
              patrollers: { total: 5, active: 3, inactive: 1, alert: 1 },
              checkpoints: { total: 10 },
              suspiciousScans: { windowDays: 7, flagged: 0 },
            },
            meta: {},
          }),
          { status: 200 }
        )
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getRoundsStatus('org1', 'jwt');

      expect(result).toEqual({ windowDays: 7, open: 1, completed: 2, incomplete: 2 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBase}/api/organizations/org1/support-summary?windowDays=7`);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    });

    it('no-2xx -> lanza', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('err', { status: 500 }));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getRoundsStatus('org1', 'jwt')).rejects.toThrow();
    });
  });

  describe('getRecentScans', () => {
    it('GET /api/scans con organizationId, limit y Bearer; mapea fraudFlagged y explica validación y motivos de sospecha reales', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        apiResponse(
          JSON.stringify({
            success: true,
            message: 'OK',
            data: {
              results: [
                {
                  timestamp: '2026-07-29T08:00:00Z',
                  checkpointName: 'Entrada',
                  patrollerName: 'Juan',
                  location: { latitude: 1, longitude: 2 },
                  fraudFlags: {
                    flagged: true,
                    gpsProximity: { status: 'fail', distance: 90 },
                    undergroundMode: { status: 'pass' },
                  },
                  validationStatus: 'pending_review',
                  validationReason: 'untyped_scan_on_protected_checkpoint',
                },
                {
                  timestamp: '2026-07-29T07:00:00Z',
                  checkpointName: 'Almacén',
                  patrollerName: 'Ana',
                  location: null,
                  fraudFlags: { flagged: false },
                  validationStatus: 'verified',
                },
                {
                  timestamp: '2026-07-29T06:00:00Z',
                  checkpointName: null,
                  patrollerName: null,
                  location: null,
                  fraudFlags: { flagged: true, gpsProximity: { status: 'fail' } },
                  validationStatus: 'rejected',
                  redacted: true,
                },
              ],
              count: 3,
              totalPages: 1,
            },
            meta: {},
          }),
          { status: 200 }
        )
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getRecentScans('org1', 'jwt');

      expect(result.items).toEqual([
        {
          timestamp: '2026-07-29T08:00:00Z',
          checkpointName: 'Entrada',
          patrollerName: 'Juan',
          fraudFlagged: true,
          validacion:
            'pendiente de revisión: faltaban datos para verificarlo; no se descarta, y hoy no se puede aprobar ni rechazar a mano (motivo: escaneo sin datos de verificación en un checkpoint protegido)',
          motivosSospecha: [
            'el GPS del móvil estaba más lejos del punto que la distancia máxima configurada (severidad media)',
          ],
        },
        {
          timestamp: '2026-07-29T07:00:00Z',
          checkpointName: 'Almacén',
          patrollerName: 'Ana',
          fraudFlagged: false,
          validacion: 'válido: es un escaneo auténtico de un punto real',
          motivosSospecha: [],
        },
        {
          timestamp: '2026-07-29T06:00:00Z',
          checkpointName: null,
          patrollerName: null,
          fraudFlagged: false,
          validacion: 'oculto por la retención de datos',
          motivosSospecha: [],
        },
      ]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBase}/api/scans?organizationId=org1&limit=10`);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    });

    it('usa el limit pasado en vez del default', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        apiResponse(
          JSON.stringify({
            success: true,
            message: 'OK',
            data: { results: [], count: 0, totalPages: 0 },
            meta: {},
          }),
          { status: 200 }
        )
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await client.getRecentScans('org1', 'jwt', { limit: 5 });

      const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBase}/api/scans?organizationId=org1&limit=5`);
    });

    it('sin opts -> limit=10 y sin parámetros de fecha', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        apiResponse(
          JSON.stringify({
            success: true,
            message: 'OK',
            data: { results: [], count: 0, totalPages: 0 },
            meta: {},
          }),
          { status: 200 }
        )
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await client.getRecentScans('org1', 'jwt');

      const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBase}/api/scans?organizationId=org1&limit=10`);
      expect(url).not.toContain('dateFrom');
      expect(url).not.toContain('dateTo');
    });

    it('con dateFrom/dateTo/limit=100 -> los incluye en la URL (codificados)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        apiResponse(
          JSON.stringify({
            success: true,
            message: 'OK',
            data: { results: [], count: 0, totalPages: 0 },
            meta: {},
          }),
          { status: 200 }
        )
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await client.getRecentScans('org1', 'jwt', {
        limit: 100,
        dateFrom: '2026-07-29T00:00:00.000Z',
        dateTo: '2026-07-30T00:00:00.000Z',
      });

      const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `${apiBase}/api/scans?organizationId=org1&limit=100&dateFrom=${encodeURIComponent('2026-07-29T00:00:00.000Z')}&dateTo=${encodeURIComponent('2026-07-30T00:00:00.000Z')}`
      );
    });

    it('no-2xx -> lanza', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('err', { status: 500 }));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getRecentScans('org1', 'jwt')).rejects.toThrow();
    });
  });

  describe('getRoundsDetail', () => {
    function routesResponse(routes: { id: string; name: string; isActive: boolean }[]) {
      return apiResponse(
        JSON.stringify({
          success: true,
          message: 'OK',
          data: { results: routes, count: routes.length, totalPages: 1 },
          meta: {},
        }),
        { status: 200 }
      );
    }

    function roundsResponse(rounds: Record<string, unknown>[]) {
      return apiResponse(
        JSON.stringify({
          success: true,
          message: 'OK',
          data: { results: rounds, count: rounds.length, totalPages: 1 },
          meta: {},
        }),
        { status: 200 }
      );
    }

    it('GET /api/routes y luego /api/routes/<id>/rounds por ruta; mapea a RouteRoundsSummary', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/routes?')) {
          return routesResponse([{ id: 'r1', name: 'Ruta Norte', isActive: true }]);
        }
        if (url.includes('/api/routes/r1/rounds')) {
          return roundsResponse([
            {
              id: 'round1',
              patrollerName: 'Juan',
              startTime: '2026-07-29T06:00:00Z',
              endTime: '2026-07-29T07:00:00Z',
              status: 'completed',
              completedCheckpoints: 6,
              totalCheckpoints: 6,
            },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getRoundsDetail('org1', 'jwt');

      expect(result.items).toEqual([
        {
          routeName: 'Ruta Norte',
          isActive: true,
          rounds: [
            {
              status: 'completed',
              patrollerName: 'Juan',
              completedCheckpoints: 6,
              totalCheckpoints: 6,
              startTime: '2026-07-29T06:00:00Z',
              endTime: '2026-07-29T07:00:00Z',
            },
          ],
        },
      ]);
      const routesCall = fetchImpl.mock.calls.find(([u]) => String(u).includes('/api/routes?'));
      expect(routesCall?.[0]).toBe(`${apiBase}/api/routes?organizationId=org1&limit=20`);
      const roundsCall = fetchImpl.mock.calls.find(([u]) => String(u).includes('/rounds'));
      expect(roundsCall?.[0]).toBe(`${apiBase}/api/routes/r1/rounds?limit=3`);
      const headers = roundsCall?.[1];
      expect((headers?.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    });

    it('limita a 8 rutas aunque el backend devuelva más', async () => {
      const routes = Array.from({ length: 12 }, (_, i) => ({
        id: `r${i}`,
        name: `Ruta ${i}`,
        isActive: true,
      }));
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/routes?')) return routesResponse(routes);
        return roundsResponse([]);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getRoundsDetail('org1', 'jwt');

      expect(result.items).toHaveLength(8);
      // …y lo AVISA: 8 de 12 rutas no puede presentarse como "todas".
      expect(result.truncado).toBe(true);
      expect(result.total).toBe(12);
      const roundsCalls = fetchImpl.mock.calls.filter(([u]) => String(u).includes('/rounds'));
      expect(roundsCalls).toHaveLength(8);
    });

    it('si la petición de rondas de una ruta falla, esa ruta queda con rounds vacío y no tumba el resto', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/routes?')) {
          return routesResponse([
            { id: 'r1', name: 'Ruta Norte', isActive: true },
            { id: 'r2', name: 'Ruta Sur', isActive: true },
          ]);
        }
        if (url.includes('/api/routes/r1/rounds')) {
          return new Response('err', { status: 500 });
        }
        if (url.includes('/api/routes/r2/rounds')) {
          return roundsResponse([
            {
              id: 'round1',
              patrollerName: 'Ana',
              startTime: '2026-07-29T06:00:00Z',
              endTime: null,
              status: 'in_progress',
              completedCheckpoints: 2,
              totalCheckpoints: 6,
            },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getRoundsDetail('org1', 'jwt');

      // La ruta que falló lleva `error`: "sin rondas" y "no se pudo leer" no son lo mismo.
      expect(result.items[0]).toMatchObject({
        routeName: 'Ruta Norte',
        isActive: true,
        rounds: [],
      });
      expect(result.items[0].error).toMatch(/no se pudieron leer las rondas/i);
      expect(result.items).toEqual([
        {
          routeName: 'Ruta Norte',
          isActive: true,
          rounds: [],
          error: expect.stringContaining('no se pudieron leer'),
        },
        {
          routeName: 'Ruta Sur',
          isActive: true,
          rounds: [
            {
              status: 'in_progress',
              patrollerName: 'Ana',
              completedCheckpoints: 2,
              totalCheckpoints: 6,
              startTime: '2026-07-29T06:00:00Z',
              endTime: null,
            },
          ],
        },
      ]);
    });

    it('/api/routes no-2xx -> lanza', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('err', { status: 500 }));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getRoundsDetail('org1', 'jwt')).rejects.toThrow();
    });
  });

  describe('getPatrollerStats', () => {
    function patrollersResponse(patrollers: Record<string, unknown>[]) {
      return apiResponse(
        JSON.stringify({
          success: true,
          message: 'OK',
          data: { results: patrollers, count: patrollers.length, totalPages: 1 },
          meta: {},
        }),
        { status: 200 }
      );
    }

    function statsResponse(stats: Record<string, unknown>) {
      return apiResponse(JSON.stringify({ success: true, message: 'OK', data: stats, meta: {} }), {
        status: 200,
      });
    }

    const rawStats = {
      totalScans: 42,
      roundsCompleted: 8,
      totalRounds: 10,
      completionRate: 0.8,
      avgTimeBetweenScans: 15.5,
      scansByDay: [{ date: '2026-07-29', count: 5 }],
    };

    it('lista vigilantes, resuelve por nombre exacto (case-insensitive) y consulta /stats del id resuelto', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/patrollers?')) {
          return patrollersResponse([
            {
              id: 'p1',
              name: 'Juan García',
              identifier: 'JG-1',
              organizationId: 'org1',
              lastScanDate: null,
              status: 'active',
            },
            {
              id: 'p2',
              name: 'María López',
              identifier: 'ML-1',
              organizationId: 'org1',
              lastScanDate: null,
              status: 'active',
            },
          ]);
        }
        if (url.includes('/api/patrollers/p1/stats')) {
          return statsResponse(rawStats);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getPatrollerStats('org1', 'jwt', 'juan garcía');

      expect(result).toEqual({
        found: true,
        name: 'Juan García',
        totalScans: 42,
        roundsCompleted: 8,
        totalRounds: 10,
        completionRate: 0.8,
        avgTimeBetweenScans: 15.5,
      });
      const listCall = fetchImpl.mock.calls.find(([u]) => String(u).includes('/api/patrollers?'));
      expect(listCall?.[0]).toBe(`${apiBase}/api/patrollers?organizationId=org1&limit=100`);
      const statsCall = fetchImpl.mock.calls.find(([u]) => String(u).includes('/stats'));
      expect(statsCall?.[0]).toBe(`${apiBase}/api/patrollers/p1/stats`);
      const headers = statsCall?.[1];
      expect((headers?.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    });

    it('resuelve por substring cuando no hay coincidencia exacta', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/patrollers?')) {
          return patrollersResponse([
            {
              id: 'p1',
              name: 'Juan García',
              identifier: 'JG-1',
              organizationId: 'org1',
              status: 'active',
            },
          ]);
        }
        if (url.includes('/api/patrollers/p1/stats')) {
          return statsResponse(rawStats);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getPatrollerStats('org1', 'jwt', 'garcía');

      expect(result).toMatchObject({ found: true, name: 'Juan García' });
    });

    it('nombre no reconocido -> found:false con opciones y NO consulta /stats', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/patrollers?')) {
          return patrollersResponse([
            {
              id: 'p1',
              name: 'Juan García',
              identifier: 'JG-1',
              organizationId: 'org1',
              status: 'active',
            },
            {
              id: 'p2',
              name: 'María López',
              identifier: 'ML-1',
              organizationId: 'org1',
              status: 'active',
            },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getPatrollerStats('org1', 'jwt', 'Pedro Nadie');

      expect(result).toEqual({ found: false, opciones: ['Juan García', 'María López'] });
      const statsCall = fetchImpl.mock.calls.find(([u]) => String(u).includes('/stats'));
      expect(statsCall).toBeUndefined();
    });

    it('/api/patrollers no-2xx -> lanza', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('err', { status: 500 }));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getPatrollerStats('org1', 'jwt', 'Juan')).rejects.toThrow();
    });

    it('mapea incidentsReported/incidentsOpen cuando vienen en la respuesta de /stats', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/patrollers?')) {
          return patrollersResponse([
            {
              id: 'p1',
              name: 'Juan García',
              identifier: 'JG-1',
              organizationId: 'org1',
              status: 'active',
            },
          ]);
        }
        if (url.includes('/api/patrollers/p1/stats')) {
          return statsResponse({ ...rawStats, incidentsReported: 3, incidentsOpen: 1 });
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getPatrollerStats('org1', 'jwt', 'Juan García');

      expect(result).toEqual({
        found: true,
        name: 'Juan García',
        totalScans: 42,
        roundsCompleted: 8,
        totalRounds: 10,
        completionRate: 0.8,
        avgTimeBetweenScans: 15.5,
        incidentsReported: 3,
        incidentsOpen: 1,
      });
    });

    it('sin incidentsReported/incidentsOpen en la respuesta -> no los incluye en el resultado', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/patrollers?')) {
          return patrollersResponse([
            {
              id: 'p1',
              name: 'Juan García',
              identifier: 'JG-1',
              organizationId: 'org1',
              status: 'active',
            },
          ]);
        }
        if (url.includes('/api/patrollers/p1/stats')) {
          return statsResponse(rawStats);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getPatrollerStats('org1', 'jwt', 'Juan García');

      expect(result).toEqual({
        found: true,
        name: 'Juan García',
        totalScans: 42,
        roundsCompleted: 8,
        totalRounds: 10,
        completionRate: 0.8,
        avgTimeBetweenScans: 15.5,
      });
      expect(result).not.toHaveProperty('incidentsReported');
      expect(result).not.toHaveProperty('incidentsOpen');
    });
  });

  describe('getPatrollerRanking', () => {
    const rawRanking = {
      summary: {
        totalScans: 87,
        activePatrollers: 3,
        avgScansPerPatroller: 29,
        bestCompletionRate: 0.95,
      },
      ranking: [
        {
          patrollerId: 'p1',
          patrollerName: 'Juan García',
          patrollerIdentifier: 'JG-1',
          totalScans: 42,
          roundsCompleted: 8,
          completionRate: 0.95,
          avgTimeBetweenScans: 15.5,
        },
        {
          patrollerId: 'p2',
          patrollerName: 'María López',
          patrollerIdentifier: 'ML-1',
          totalScans: 30,
          roundsCompleted: 6,
          completionRate: 0.8,
          avgTimeBetweenScans: 18.2,
        },
      ],
      topCheckpoints: [
        { checkpointName: 'Entrada principal', totalScans: 30 },
        { checkpointName: 'Almacén', totalScans: 22 },
      ],
    };

    function rankingResponse(body: Record<string, unknown>) {
      return apiResponse(JSON.stringify({ success: true, message: 'OK', data: body, meta: {} }), {
        status: 200,
      });
    }

    it('GET /api/patrollers/ranking con organizationId y Bearer; mapea summary/ranking/topCheckpoints', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => rankingResponse(rawRanking));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getPatrollerRanking('org1', 'jwt');

      expect(result).toEqual({
        truncado: false,
        summary: rawRanking.summary,
        ranking: [
          {
            patrollerName: 'Juan García',
            totalScans: 42,
            roundsCompleted: 8,
            completionRate: 0.95,
            avgTimeBetweenScans: 15.5,
          },
          {
            patrollerName: 'María López',
            totalScans: 30,
            roundsCompleted: 6,
            completionRate: 0.8,
            avgTimeBetweenScans: 18.2,
          },
        ],
        topCheckpoints: rawRanking.topCheckpoints,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBase}/api/patrollers/ranking?organizationId=org1`);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    });

    it('con dateFrom/dateTo -> los incluye como from/to (codificados)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => rankingResponse(rawRanking));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await client.getPatrollerRanking('org1', 'jwt', {
        dateFrom: '2026-07-29T00:00:00.000Z',
        dateTo: '2026-07-30T00:00:00.000Z',
      });

      const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `${apiBase}/api/patrollers/ranking?organizationId=org1&from=${encodeURIComponent('2026-07-29T00:00:00.000Z')}&to=${encodeURIComponent('2026-07-30T00:00:00.000Z')}`
      );
    });

    it('sin opts -> no incluye from/to en la URL', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => rankingResponse(rawRanking));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await client.getPatrollerRanking('org1', 'jwt');

      const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain('from=');
      expect(url).not.toContain('to=');
    });

    it('cap: no devuelve más de 15 entradas de ranking ni más de 10 topCheckpoints', async () => {
      const bigRanking = {
        summary: rawRanking.summary,
        ranking: Array.from({ length: 20 }, (_, i) => ({
          patrollerId: `p${i}`,
          patrollerName: `Vigilante ${i}`,
          totalScans: 10,
          roundsCompleted: 1,
          completionRate: 0.5,
          avgTimeBetweenScans: 10,
        })),
        topCheckpoints: Array.from({ length: 15 }, (_, i) => ({
          checkpointName: `Checkpoint ${i}`,
          totalScans: 5,
        })),
      };
      const fetchImpl = vi.fn<typeof fetch>(async () => rankingResponse(bigRanking));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getPatrollerRanking('org1', 'jwt');

      expect(result.ranking).toHaveLength(15);
      expect(result.topCheckpoints).toHaveLength(10);
      // el cap se AVISA, no se disimula
      expect(result.truncado).toBe(true);
    });

    it('no-2xx -> lanza', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('err', { status: 500 }));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getPatrollerRanking('org1', 'jwt')).rejects.toThrow();
    });
  });

  describe('getRoundCheckpoints', () => {
    function routesResponse(routes: { id: string; name: string; isActive: boolean }[]) {
      return apiResponse(
        JSON.stringify({
          success: true,
          message: 'OK',
          data: { results: routes, count: routes.length, totalPages: 1 },
          meta: {},
        }),
        { status: 200 }
      );
    }

    function roundsResponse(rounds: Record<string, unknown>[]) {
      return apiResponse(
        JSON.stringify({
          success: true,
          message: 'OK',
          data: { results: rounds, count: rounds.length, totalPages: 1 },
          meta: {},
        }),
        { status: 200 }
      );
    }

    function checkpointsResponse(body: Record<string, unknown>) {
      return apiResponse(JSON.stringify({ success: true, message: 'OK', data: body, meta: {} }), {
        status: 200,
      });
    }

    it('resuelve la ruta, obtiene la última ronda y mapea el detalle de checkpoints', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/routes?')) {
          return routesResponse([
            { id: 'r1', name: 'Ruta Norte', isActive: true },
            { id: 'r2', name: 'Ruta Sur', isActive: true },
          ]);
        }
        if (url.includes('/api/routes/r1/rounds/round1/checkpoints')) {
          return checkpointsResponse({
            roundId: 'round1',
            routeId: 'r1',
            status: 'incomplete',
            scannedCount: 2,
            totalCount: 3,
            checkpoints: [
              {
                checkpointId: 'c1',
                checkpointName: 'Entrada',
                order: 1,
                scanned: true,
                scanTime: '2026-07-29T06:05:00Z',
              },
              {
                checkpointId: 'c2',
                checkpointName: 'Almacén',
                order: 2,
                scanned: true,
                scanTime: '2026-07-29T06:20:00Z',
              },
              {
                checkpointId: 'c3',
                checkpointName: 'Azotea',
                order: 3,
                scanned: false,
                scanTime: null,
              },
            ],
          });
        }
        if (url.includes('/api/routes/r1/rounds')) {
          return roundsResponse([
            {
              id: 'round1',
              status: 'incomplete',
              patrollerName: 'Juan',
              startTime: '2026-07-29T06:00:00Z',
              endTime: '2026-07-29T07:00:00Z',
              completedCheckpoints: 2,
              totalCheckpoints: 3,
            },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getRoundCheckpoints('org1', 'jwt', 'ruta norte');

      expect(result).toEqual({
        found: true,
        routeName: 'Ruta Norte',
        status: 'incomplete',
        scannedCount: 2,
        totalCount: 3,
        checkpoints: [
          { checkpointName: 'Entrada', order: 1, scanned: true, scanTime: '2026-07-29T06:05:00Z' },
          { checkpointName: 'Almacén', order: 2, scanned: true, scanTime: '2026-07-29T06:20:00Z' },
          { checkpointName: 'Azotea', order: 3, scanned: false, scanTime: null },
        ],
      });

      const routesCall = fetchImpl.mock.calls.find(([u]) => String(u).includes('/api/routes?'));
      expect(routesCall?.[0]).toBe(`${apiBase}/api/routes?organizationId=org1&limit=50`);
      const roundsCall = fetchImpl.mock.calls.find(
        ([u]) => String(u).includes('/rounds') && !String(u).includes('/checkpoints')
      );
      expect(roundsCall?.[0]).toBe(`${apiBase}/api/routes/r1/rounds?limit=1`);
      const checkpointsCall = fetchImpl.mock.calls.find(([u]) =>
        String(u).includes('/checkpoints')
      );
      expect(checkpointsCall?.[0]).toBe(`${apiBase}/api/routes/r1/rounds/round1/checkpoints`);
      const headers = checkpointsCall?.[1];
      expect((headers?.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    });

    it('ruta no reconocida -> found:false route_not_found con opciones y NO consulta rondas ni checkpoints', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/routes?')) {
          return routesResponse([
            { id: 'r1', name: 'Ruta Norte', isActive: true },
            { id: 'r2', name: 'Ruta Sur', isActive: true },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getRoundCheckpoints('org1', 'jwt', 'Ruta Inexistente');

      expect(result).toEqual({
        found: false,
        reason: 'route_not_found',
        opciones: ['Ruta Norte', 'Ruta Sur'],
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('sin ruta indicada y VARIAS rutas -> route_not_specified con opciones (no consulta rondas)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/routes?')) {
          return routesResponse([
            { id: 'r1', name: 'Ruta Norte', isActive: true },
            { id: 'r2', name: 'Ruta Sur', isActive: true },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });
      const result = await client.getRoundCheckpoints('org1', 'jwt');
      expect(result).toEqual({
        found: false,
        reason: 'route_not_specified',
        opciones: ['Ruta Norte', 'Ruta Sur'],
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('sin ruta indicada y UNA sola ruta activa -> la usa por defecto', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/routes?')) {
          return routesResponse([
            { id: 'r1', name: 'Ruta Norte', isActive: true },
            { id: 'r2', name: 'Ruta Vieja', isActive: false },
          ]);
        }
        if (url.includes('/api/routes/r1/rounds/round1/checkpoints')) {
          return checkpointsResponse({
            status: 'completed',
            scannedCount: 1,
            totalCount: 1,
            checkpoints: [
              { checkpointId: 'c1', checkpointName: 'A', order: 1, scanned: true, scanTime: 't' },
            ],
          });
        }
        if (url.includes('/api/routes/r1/rounds')) {
          return roundsResponse([
            { id: 'round1', status: 'completed', completedCheckpoints: 1, totalCheckpoints: 1 },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });
      const result = await client.getRoundCheckpoints('org1', 'jwt');
      expect(result).toMatchObject({ found: true, routeName: 'Ruta Norte' });
    });

    it('ruta resuelta pero sin rondas -> found:false no_rounds y NO consulta checkpoints', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/routes?')) {
          return routesResponse([{ id: 'r1', name: 'Ruta Norte', isActive: true }]);
        }
        if (url.includes('/api/routes/r1/rounds')) {
          return roundsResponse([]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getRoundCheckpoints('org1', 'jwt', 'Ruta Norte');

      expect(result).toEqual({ found: false, reason: 'no_rounds' });
      const checkpointsCall = fetchImpl.mock.calls.find(([u]) =>
        String(u).includes('/checkpoints')
      );
      expect(checkpointsCall).toBeUndefined();
    });

    it('/api/routes no-2xx -> lanza', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('err', { status: 500 }));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getRoundCheckpoints('org1', 'jwt', 'Ruta Norte')).rejects.toThrow();
    });
  });

  describe('getCheckpoints', () => {
    function envelopedLocations(locations: { id: string; name: string }[]) {
      return apiResponse(
        JSON.stringify({
          success: true,
          message: 'OK',
          data: { results: locations, count: locations.length, totalPages: 1 },
          meta: {},
        }),
        { status: 200 }
      );
    }

    function rawLocations(locations: { id: string; name: string }[]) {
      return apiResponse(
        JSON.stringify({ results: locations, count: locations.length, totalPages: 1 }),
        { status: 200 }
      );
    }

    function envelopedCheckpoints(checkpoints: Record<string, unknown>[]) {
      return apiResponse(
        JSON.stringify({
          success: true,
          message: 'OK',
          data: { results: checkpoints, count: checkpoints.length, totalPages: 1 },
          meta: {},
        }),
        { status: 200 }
      );
    }

    function rawCheckpoints(checkpoints: Record<string, unknown>[]) {
      return apiResponse(
        JSON.stringify({ results: checkpoints, count: checkpoints.length, totalPages: 1 }),
        { status: 200 }
      );
    }

    it('GET /api/locations y luego /api/checkpoints por ubicación; agrega nombre + ubicación', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/locations?')) {
          return envelopedLocations([
            { id: 'loc1', name: 'Sede Central' },
            { id: 'loc2', name: 'Sucursal Norte' },
          ]);
        }
        if (url.includes('locationId=loc1')) {
          return envelopedCheckpoints([
            { id: 'c1', name: 'Entrada principal', locationId: 'loc1', archivedAt: null },
            { id: 'c2', name: 'Almacén', locationId: 'loc1', archivedAt: null },
          ]);
        }
        if (url.includes('locationId=loc2')) {
          return envelopedCheckpoints([
            { id: 'c3', name: 'Recepción', locationId: 'loc2', archivedAt: null },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getCheckpoints('org1', 'jwt');

      expect(result.items).toEqual([
        { id: 'c1', name: 'Entrada principal', locationName: 'Sede Central' },
        { id: 'c2', name: 'Almacén', locationName: 'Sede Central' },
        { id: 'c3', name: 'Recepción', locationName: 'Sucursal Norte' },
      ]);
      expect(result.truncado).toBe(false);
      expect(result.ubicacionesConError).toBe(0);
      const locationsCall = fetchImpl.mock.calls.find(([u]) =>
        String(u).includes('/api/locations?')
      );
      expect(locationsCall?.[0]).toBe(`${apiBase}/api/locations?organizationId=org1`);
      const checkpointsCall = fetchImpl.mock.calls.find(([u]) =>
        String(u).includes('locationId=loc1')
      );
      expect(checkpointsCall?.[0]).toBe(`${apiBase}/api/checkpoints?locationId=loc1&limit=100`);
      const headers = checkpointsCall?.[1];
      expect((headers?.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    });

    it('excluye checkpoints archivados (archivedAt != null)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/locations?')) {
          return envelopedLocations([{ id: 'loc1', name: 'Sede Central' }]);
        }
        if (url.includes('locationId=loc1')) {
          return envelopedCheckpoints([
            { id: 'c1', name: 'Entrada principal', locationId: 'loc1', archivedAt: null },
            {
              id: 'c2',
              name: 'Almacén viejo',
              locationId: 'loc1',
              archivedAt: '2026-01-01T00:00:00Z',
            },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getCheckpoints('org1', 'jwt');

      expect(result.items).toEqual([
        { id: 'c1', name: 'Entrada principal', locationName: 'Sede Central' },
      ]);
    });

    it('si la consulta de checkpoints de una ubicación falla, se omite esa ubicación, se CUENTA y no tumba el resto', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/locations?')) {
          return envelopedLocations([
            { id: 'loc1', name: 'Sede Central' },
            { id: 'loc2', name: 'Sucursal Norte' },
          ]);
        }
        if (url.includes('locationId=loc1')) {
          return new Response('err', { status: 500 });
        }
        if (url.includes('locationId=loc2')) {
          return envelopedCheckpoints([
            { id: 'c3', name: 'Recepción', locationId: 'loc2', archivedAt: null },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getCheckpoints('org1', 'jwt');

      expect(result.items).toEqual([
        { id: 'c3', name: 'Recepción', locationName: 'Sucursal Norte' },
      ]);
      // La ubicación que falló se cuenta: sus checkpoints faltan, no es que no existan.
      expect(result.ubicacionesConError).toBe(1);
    });

    it('limita a 20 ubicaciones aunque el backend devuelva más', async () => {
      const locations = Array.from({ length: 25 }, (_, i) => ({
        id: `loc${i}`,
        name: `Ubicación ${i}`,
      }));
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/locations?')) return envelopedLocations(locations);
        return envelopedCheckpoints([]);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getCheckpoints('org1', 'jwt');

      const checkpointsCalls = fetchImpl.mock.calls.filter(([u]) =>
        String(u).includes('/api/checkpoints?')
      );
      expect(checkpointsCalls).toHaveLength(20);
      expect(result.truncado).toBe(true);
    });

    it('maneja el shape RAW (sin envelope) tanto para /api/locations como para /api/checkpoints', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/locations?')) {
          return rawLocations([{ id: 'loc1', name: 'Sede Central' }]);
        }
        if (url.includes('locationId=loc1')) {
          return rawCheckpoints([
            { id: 'c1', name: 'Entrada principal', locationId: 'loc1', archivedAt: null },
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getCheckpoints('org1', 'jwt');

      expect(result.items).toEqual([
        { id: 'c1', name: 'Entrada principal', locationName: 'Sede Central' },
      ]);
    });

    it('/api/locations no-2xx -> lanza', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('err', { status: 500 }));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await expect(client.getCheckpoints('org1', 'jwt')).rejects.toThrow();
    });
  });

  describe('truncados y resolución ambigua', () => {
    function enveloped(data: unknown) {
      return apiResponse(JSON.stringify({ success: true, message: 'OK', data, meta: {} }), {
        status: 200,
      });
    }

    it('getRecentScans: con count mayor que lo devuelto, marca truncado y el total', async () => {
      const results = Array.from({ length: 100 }, (_, i) => ({
        timestamp: `2026-07-29T08:00:0${i % 10}Z`,
        checkpointName: 'Entrada',
        patrollerName: 'Juan',
        location: null,
        fraudFlags: null,
        validationStatus: null,
      }));
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        enveloped({ results, count: 3000, totalPages: 30 })
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getRecentScans('org1', 'jwt', { limit: 100 });

      expect(result.items).toHaveLength(100);
      expect(result.truncado).toBe(true);
      expect(result.total).toBe(3000);
    });

    it('getPatrollerActivity: totalPages > 1 marca truncado', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        enveloped({
          results: [{ name: 'Juan', lastScanDate: null, status: 'active' }],
          count: 1,
          totalPages: 4,
        })
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      expect((await client.getPatrollerActivity('org1', 'jwt')).truncado).toBe(true);
    });

    it('getPatrollerStats con nombre vacío: NO devuelve el primer vigilante', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        enveloped({
          results: [
            {
              id: 'p1',
              name: 'Juan García',
              identifier: 'JG',
              organizationId: 'org1',
              status: 'active',
            },
            {
              id: 'p2',
              name: 'María López',
              identifier: 'ML',
              organizationId: 'org1',
              status: 'active',
            },
          ],
          count: 2,
          totalPages: 1,
        })
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getPatrollerStats('org1', 'jwt', '');

      expect(result).toEqual({ found: false, opciones: ['Juan García', 'María López'] });
      // no llega a pedir las stats de nadie
      expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes('/stats'))).toHaveLength(0);
    });

    it('getPatrollerStats con un nombre que casa con varios: ambigua, con las opciones', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        enveloped({
          results: [
            {
              id: 'p1',
              name: 'Juan García',
              identifier: 'JG',
              organizationId: 'org1',
              status: 'active',
            },
            {
              id: 'p2',
              name: 'Juan Pérez',
              identifier: 'JP',
              organizationId: 'org1',
              status: 'active',
            },
          ],
          count: 2,
          totalPages: 1,
        })
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getPatrollerStats('org1', 'jwt', 'Juan');

      expect(result).toEqual({
        found: false,
        ambigua: true,
        opciones: ['Juan García', 'Juan Pérez'],
      });
      expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes('/stats'))).toHaveLength(0);
    });

    it('getRoundCheckpoints con una ruta que casa con varias: route_ambiguous', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        enveloped({
          results: [
            { id: 'r1', name: 'Ruta Norte Turno A', isActive: true },
            { id: 'r2', name: 'Ruta Norte Turno B', isActive: true },
          ],
          count: 2,
          totalPages: 1,
        })
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      const result = await client.getRoundCheckpoints('org1', 'jwt', 'Ruta Norte');

      expect(result).toEqual({
        found: false,
        reason: 'route_ambiguous',
        opciones: ['Ruta Norte Turno A', 'Ruta Norte Turno B'],
      });
    });

    it('los ids se codifican en la URL (higiene, M6)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        enveloped({ results: [], count: 0, totalPages: 1 })
      );
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: fetchImpl });

      await client.getPatrollerActivity('org 1/2', 'jwt');

      const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
      // URLSearchParams del SDK: el espacio va como `+` y la barra se codifica igual.
      expect(url).toContain('organizationId=org+1%2F2');
    });
  });

  describe('defaultHeaders', () => {
    const vacio = () =>
      apiResponse(
        JSON.stringify({
          success: true,
          message: 'OK',
          data: { results: [], count: 0, totalPages: 1 },
          meta: {},
        }),
        { status: 200 }
      );
    const headersOf = (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>, call = 0) =>
      (fetchImpl.mock.calls[call] as [string, RequestInit])[1].headers as Record<string, string>;

    it('se piden en cada petición y viajan junto al Bearer', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => vacio());
      let n = 0;
      const defaultHeaders = vi.fn(() => ({
        'X-Request-Id': `req-${++n}`,
        'X-Agent-Client': 'claude',
      }));
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl, defaultHeaders });

      await client.getPatrollerActivity('org1', 'jwt');
      await client.getPatrollerActivity('org1', 'jwt');

      expect(headersOf(fetchImpl, 0)).toMatchObject({
        Authorization: 'Bearer jwt',
        'X-Request-Id': 'req-1',
        'X-Agent-Client': 'claude',
      });
      expect(headersOf(fetchImpl, 1)['X-Request-Id']).toBe('req-2');
      expect(defaultHeaders).toHaveBeenCalledTimes(2);
    });

    it('sin ellas no se añade nada (compatible con lo anterior)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => vacio());
      const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl });

      await client.getPatrollerActivity('org1', 'jwt');

      expect(Object.keys(headersOf(fetchImpl)).sort()).toEqual(['Authorization']);
    });

    it('una cabecera authorization en minúsculas tampoco se envía (no se duplica el Bearer)', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => vacio());
      const client = new SdkPatrolTechGateway({
        baseUrl: apiBase,
        fetchImpl,
        defaultHeaders: () => ({ authorization: 'Bearer otro', 'X-Agent-Client': 'claude' }),
      });

      await client.getPatrollerActivity('org1', 'jwt');

      const headers = headersOf(fetchImpl);
      expect(Object.keys(headers).filter((k) => k.toLowerCase() === 'authorization')).toEqual([
        'Authorization',
      ]);
      expect(headers['X-Agent-Client']).toBe('claude');
    });

    it('el Bearer de la petición manda sobre una cabecera Authorization de las por defecto', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => vacio());
      const client = new SdkPatrolTechGateway({
        baseUrl: apiBase,
        fetchImpl,
        defaultHeaders: () => ({ Authorization: 'Bearer otro' }),
      });

      await client.getPatrollerActivity('org1', 'jwt');

      expect(headersOf(fetchImpl).Authorization).toBe('Bearer jwt');
    });
  });
});
