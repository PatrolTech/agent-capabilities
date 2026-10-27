/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/require-await -- stubs de fetch portados del bot: la URL y el cuerpo que reciben son siempre strings y los stubs son async sin await */
import { describe, it, expect, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';
import { PatrolTechApiError } from '../../domain/backend-errors.js';

/** Respuestas «raras» del backend en los métodos nuevos (Lotes A y B). */

const apiBase = 'http://api.test';

/** El backend responde `application/json`: el SDK solo parsea JSON con esa cabecera (el bot lo hacía a ciegas). */
const apiResponse = (body: BodyInit | null, init?: ResponseInit): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/json' } });

function routedFetch(route: (path: string) => { status: number; body?: unknown }) {
  const paths: string[] = [];
  const f = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const path = String(input).slice(apiBase.length);
    paths.push(path);
    const r = route(path);
    return apiResponse(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  });
  return { f, paths };
}
const ok = (data: unknown, meta: Record<string, unknown> = {}) => ({
  status: 200,
  body: { success: true, message: 'OK', data, meta },
});

describe('SdkPatrolTechGateway — casos límite', () => {
  it('listAccessLogs: nunca pide más de 100 por página y codifica zona y fechas', async () => {
    const { f, paths } = routedFetch(() => ok({ results: [], total: 0 }));
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    await client.listAccessLogs(
      {
        locationId: 'l 1',
        zona: 'Portería & Garaje',
        tipo: 'EXIT',
        desde: '2026-10-01T00:00:00.000Z',
        hasta: '2026-10-02T00:00:00.000Z',
        page: 3,
        limit: 500,
      },
      'jwt'
    );

    expect(paths[0]).toBe(
      // El SDK serializa con URLSearchParams: el espacio va como `+` (el backend lo decodifica igual que `%20`).
      '/api/features/access-control/access-logs?locationId=l+1&page=3&limit=100&zone=Porter%C3%ADa+%26+Garaje&type=EXIT&from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-02T00%3A00%3A00.000Z'
    );
  });

  it('listAccessLogs: campos ausentes o null quedan en null; `redacted` → oculto', async () => {
    const { f } = routedFetch(() =>
      ok({
        results: [
          {
            id: 'a',
            locationId: 'l1',
            type: 'ENTRY',
            timestamp: '2026-10-10T07:00:00.000Z',
            redacted: true,
          },
        ],
        total: 1,
      })
    );
    const [a] = (
      await new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f }).listAccessLogs(
        { locationId: 'l1' },
        'jwt'
      )
    ).items;
    expect(a).toEqual({
      id: 'a',
      locationId: 'l1',
      zona: null,
      tipo: 'ENTRY',
      fecha: '2026-10-10T07:00:00.000Z',
      persona: null,
      identificadorPersona: null,
      visitante: null,
      documentoVisitante: null,
      empresaVisitante: null,
      destino: null,
      notas: null,
      oculto: true,
    });
  });

  it('getIncidentDetail: 404 → null; 403 (otra ubicación) lanza', async () => {
    const client404 = new SdkPatrolTechGateway({
      baseUrl: apiBase,
      fetchImpl: routedFetch(() => ({
        status: 404,
        body: { success: false, message: 'Incident not found' },
      })).f,
    });
    expect(
      await client404.getIncidentDetail(
        { incidentId: 'i1', organizationId: 'o1', locationId: null },
        'jwt'
      )
    ).toBeNull();
    const client403 = new SdkPatrolTechGateway({
      baseUrl: apiBase,
      fetchImpl: routedFetch(() => ({
        status: 403,
        body: { success: false, message: 'Forbidden' },
      })).f,
    });
    await expect(
      client403.getIncidentDetail(
        { incidentId: 'i1', organizationId: 'o1', locationId: 'l1' },
        'jwt'
      )
    ).rejects.toBeInstanceOf(PatrolTechApiError);
  });

  it('getIncidentDetail: sin timeline, media ni checkpoints (backend mínimo) → listas vacías y 0 adjuntos; tipos de media desconocidos no cuentan', async () => {
    const { f, paths } = routedFetch(() =>
      ok({
        id: 'i1',
        status: 'OPEN',
        priority: 'LOW',
        createdAt: '2026-10-10T07:00:00.000Z',
        media: [{ type: 'AUDIO' }, { type: 'PHOTO' }],
      })
    );
    const d = await new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f }).getIncidentDetail(
      { incidentId: 'i/1', organizationId: 'o1', locationId: null },
      'jwt'
    );
    expect(paths[0]).toBe('/api/features/incident-reporting/incidents/i%2F1?organizationId=o1');
    expect(d).toMatchObject({
      titulo: null,
      descripcion: null,
      checkpoints: [],
      timeline: [],
      fotos: 1,
      videos: 0,
      oculta: false,
      locationId: null,
    });
  });

  it('inviteUser: 200 con `meta` vacío o sin `meta` → cuenta ya existente, con aviso enviado', async () => {
    const { f } = routedFetch(() => ({
      status: 200,
      body: { success: true, message: 'Role assigned to existing user', data: null },
    }));
    const r = await new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f }).inviteUser(
      {
        organizationId: 'o1',
        name: 'Luis',
        email: 'luis@x.test',
        roleType: 'VIEWER',
        roleScope: 'ORGANIZATION',
      },
      'jwt'
    );
    expect(r).toEqual({ cuentaNueva: false, emailEnviado: true });
  });

  it('inviteUser: con ámbito ORGANIZATION nunca manda un locationId aunque llegue', async () => {
    const { f } = routedFetch(() => ({
      status: 201,
      body: { success: true, message: 'ok', data: null, meta: { emailSent: true } },
    }));
    await new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f }).inviteUser(
      {
        organizationId: 'o1',
        name: 'Luis',
        email: 'luis@x.test',
        roleType: 'VIEWER',
        roleScope: 'ORGANIZATION',
        locationId: 'l-de-otra-org',
      },
      'jwt'
    );
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).not.toHaveProperty('locationId');
  });

  it('updateLocation sin nada que cambiar manda un body vacío (no null ni campos vacíos)', async () => {
    const { f } = routedFetch(() => ok({ id: 'l1' }));
    await new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f }).updateLocation(
      { id: 'l1', name: '', address: '' },
      'jwt'
    );
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({});
  });
});
