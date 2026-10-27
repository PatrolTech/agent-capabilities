/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/require-await -- stubs de fetch portados del bot: la URL y el cuerpo que reciben son siempre strings y los stubs son async sin await */
import { describe, it, expect, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';
import { isFeatureDisabled, PatrolTechApiError } from '../../domain/backend-errors.js';

const apiBase = 'http://api.test';

/** El backend responde `application/json`: el SDK solo parsea JSON con esa cabecera (el bot lo hacía a ciegas). */
const apiResponse = (body: BodyInit | null, init?: ResponseInit): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/json' } });

/** fetch falso con una respuesta fija (envuelta como la del backend); apunta método, ruta y cuerpo. */
function fakeFetch(status: number, data: unknown) {
  const body = status < 400 ? { success: true, message: 'OK', data, meta: {} } : data;
  const f = vi.fn<typeof fetch>(async () => apiResponse(JSON.stringify(body), { status }));
  const calls = () =>
    f.mock.calls.map(([u, init]) => ({
      method: init?.method,
      path: String(u).slice(apiBase.length),
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    }));
  return { f, calls };
}

const target = { incidentId: 'i1', organizationId: 'org1', locationId: 'loc1' };

describe('SdkPatrolTechGateway — archivo, incidencias y usuarios', () => {
  it('listIncidents: por organización, más recientes primero, con filtro de estado; oculta el título de las redactadas', async () => {
    const { f, calls } = fakeFetch(200, {
      results: [
        {
          id: 'i1',
          title: 'Puerta',
          status: 'OPEN',
          priority: 'HIGH',
          locationId: 'loc1',
          assignedToUserId: null,
          assignedToName: null,
          createdAt: '2026-09-01T00:00:00.000Z',
          redacted: false,
        },
        {
          id: 'i2',
          title: null,
          status: 'CLOSED',
          priority: 'LOW',
          locationId: null,
          assignedToUserId: 'u1',
          assignedToName: null,
          createdAt: '2025-01-01T00:00:00.000Z',
          redacted: true,
        },
      ],
      total: 120,
      page: 1,
      limit: 100,
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const r = await client.listIncidents('org1', 'jwt', { estado: 'OPEN' });

    expect(calls()[0]).toEqual({
      method: 'GET',
      path: '/api/features/incident-reporting/incidents?organizationId=org1&limit=100&sortBy=createdAt&sortOrder=DESC&status=OPEN',
      body: undefined,
    });
    expect(r.items[0]).toEqual({
      id: 'i1',
      titulo: 'Puerta',
      estado: 'OPEN',
      prioridad: 'HIGH',
      locationId: 'loc1',
      asignadoAId: null,
      asignadoA: null,
      creadaEn: '2026-09-01T00:00:00.000Z',
    });
    expect(r.items[1].titulo).toBeNull();
    expect(r).toMatchObject({ total: 120, truncado: true });
  });

  it('estado, asignación y comentario: PATCH/POST con el cuerpo exacto y la ubicación en la query', async () => {
    const { f, calls } = fakeFetch(200, { updated: true });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    await client.updateIncidentStatus(
      { ...target, estado: 'DISCARDED', comentario: 'Falsa alarma' },
      'jwt'
    );
    await client.updateIncidentStatus({ ...target, estado: 'IN_PROGRESS' }, 'jwt');
    await client.assignIncident({ ...target, userId: 'u1' }, 'jwt');
    await client.commentIncident({ ...target, locationId: null, comentario: 'Hola' }, 'jwt');

    expect(calls()).toEqual([
      {
        method: 'PATCH',
        path: '/api/features/incident-reporting/incidents/i1/status?locationId=loc1',
        body: { status: 'DISCARDED', comment: 'Falsa alarma' },
      },
      {
        method: 'PATCH',
        path: '/api/features/incident-reporting/incidents/i1/status?locationId=loc1',
        body: { status: 'IN_PROGRESS' },
      },
      {
        method: 'PATCH',
        path: '/api/features/incident-reporting/incidents/i1/assign?locationId=loc1',
        body: { assignToUserId: 'u1' },
      },
      // Sin ubicación (incidencia redactada), la organización para el gate de la App.
      {
        method: 'POST',
        path: '/api/features/incident-reporting/incidents/i1/comments?organizationId=org1',
        body: { comment: 'Hola' },
      },
    ]);
  });

  it('App de Incidencias apagada: el 403 del gate se reconoce (no es falta de permiso)', async () => {
    const { f } = fakeFetch(403, {
      success: false,
      message: "Feature 'incident-reporting' is not enabled for this organization",
      data: null,
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const err = await client.listIncidents('org1', 'jwt').catch((e: unknown) => e);

    expect(isFeatureDisabled(err)).toBe(true);
    expect(
      isFeatureDisabled(new PatrolTechApiError(403, '/x', { message: 'Insufficient permissions' }))
    ).toBe(false);
  });

  it('listOrgUsers: usuarios con sus roles y ámbito', async () => {
    const { f, calls } = fakeFetch(200, {
      results: [
        {
          id: 'u1',
          name: 'Marta',
          email: 'm@x.test',
          UserRoles: [{ id: 'r1', roleType: 'ADMIN', roleScope: 'ORGANIZATION', scopeId: 'org1' }],
        },
        { id: 'u2', name: 'Pedro', email: 'p@x.test' },
      ],
      count: 2,
      totalPages: 1,
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const users = await client.listOrgUsers('org1', 'jwt');

    expect(calls()[0].path).toBe('/api/organizations/users?organizationId=org1');
    expect(users).toEqual([
      {
        id: 'u1',
        nombre: 'Marta',
        email: 'm@x.test',
        roles: [{ id: 'r1', rol: 'ADMIN', ambito: 'ORGANIZATION', scopeId: 'org1' }],
      },
      { id: 'u2', nombre: 'Pedro', email: 'p@x.test', roles: [] },
    ]);
  });

  it('updatePatroller y updateCheckpoint: PUT solo con los campos que cambian (nunca código ni método)', async () => {
    const { f, calls } = fakeFetch(200, {
      id: 'p1',
      name: 'Luis',
      identifier: 'ABCDEF12',
      organizationId: 'org1',
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const p = await client.updatePatroller({ id: 'p1', phone: '+34600' }, 'jwt');
    await client.updateCheckpoint({ id: 'c1', name: 'Entrada norte' }, 'jwt');

    expect(calls()).toEqual([
      { method: 'PUT', path: '/api/patrollers/p1', body: { phone: '+34600' } },
      { method: 'PUT', path: '/api/checkpoints/c1', body: { name: 'Entrada norte' } },
    ]);
    expect(p).toEqual({ id: 'p1', name: 'Luis', identifier: 'ABCDEF12', organizationId: 'org1' });
  });

  it('archivar y desarchivar: POST sin confirmExtraBilling', async () => {
    const { f, calls } = fakeFetch(200, { id: 'c1' });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    await client.archiveCheckpoint('c1', 'jwt');
    await client.unarchiveCheckpoint('c1', 'jwt');

    expect(calls()).toEqual([
      // El SDK no manda cuerpo al archivar (la operación no lo define y el backend no lo lee); el bot mandaba `{}`.
      { method: 'POST', path: '/api/checkpoints/c1/archive', body: undefined },
      { method: 'POST', path: '/api/checkpoints/c1/unarchive', body: {} },
    ]);
  });

  it('archiveCheckpoint devuelve las rutas afectadas que manda el backend, o null si no las manda', async () => {
    const affectedRoutes = [{ id: 'r1', name: 'Ronda', leftEmpty: true, deactivated: true }];
    const conRutas = new SdkPatrolTechGateway({
      baseUrl: apiBase,
      fetchImpl: fakeFetch(200, { id: 'c1', affectedRoutes }).f,
    });
    const sinRutas = new SdkPatrolTechGateway({
      baseUrl: apiBase,
      fetchImpl: fakeFetch(200, { id: 'c1' }).f,
    });

    expect(await conRutas.archiveCheckpoint('c1', 'jwt')).toEqual(affectedRoutes);
    expect(await sinRutas.archiveCheckpoint('c1', 'jwt')).toBeNull();
  });

  it('listArchivedCheckpoints: includeArchived=true y solo los archivados; listCheckpoints trae el primer escaneo si viene', async () => {
    const f = vi.fn<typeof fetch>(async (input) => {
      const url = String(input).slice(apiBase.length);
      const data = url.startsWith('/api/locations')
        ? { results: [{ id: 'l1', name: 'Sede' }], count: 1, totalPages: 1 }
        : {
            results: [
              { id: 'c1', name: 'Activo', locationId: 'l1', archivedAt: null, firstScanAt: null },
              {
                id: 'c2',
                name: 'Viejo',
                locationId: 'l1',
                archivedAt: '2026-01-01T00:00:00Z',
                firstScanAt: '2025-06-01T00:00:00Z',
              },
            ],
            count: 2,
            totalPages: 1,
          };
      return apiResponse(JSON.stringify({ success: true, message: 'OK', data, meta: {} }), {
        status: 200,
      });
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const archivados = await client.listArchivedCheckpoints('org1', 'jwt');
    const activos = await client.listCheckpoints('org1', 'jwt');

    expect(String(f.mock.calls[1][0])).toContain(
      '/api/checkpoints?locationId=l1&limit=100&includeArchived=true'
    );
    expect(archivados.items.map((c) => [c.id, c.primerEscaneo])).toEqual([
      ['c2', '2025-06-01T00:00:00Z'],
    ]);
    expect(String(f.mock.calls[3][0])).not.toContain('includeArchived');
    expect(activos.items.map((c) => [c.id, c.primerEscaneo])).toEqual([['c1', null]]);
  });
});
