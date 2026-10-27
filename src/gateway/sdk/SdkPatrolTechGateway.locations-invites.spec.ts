/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/require-await -- stubs de fetch portados del bot: la URL y el cuerpo que reciben son siempre strings y los stubs son async sin await */
import { describe, it, expect, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';
import type { NewOrgUser } from '../types/index.js';

const apiBase = 'http://api.test';

/** El backend responde `application/json`: el SDK solo parsea JSON con esa cabecera (el bot lo hacía a ciegas). */
const apiResponse = (body: BodyInit | null, init?: ResponseInit): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/json' } });

/** fetch falso que devuelve, en orden, los cuerpos (ya con su envelope) y status dados; apunta método, ruta y cuerpo. */
function fakeFetch(...responses: { status: number; body?: unknown }[]) {
  const f = vi.fn<typeof fetch>(async () => {
    const r = responses.shift() ?? {
      status: 200,
      body: { success: true, message: 'OK', data: {}, meta: {} },
    };
    return apiResponse(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  });
  const calls = () =>
    f.mock.calls.map(([u, init]) => ({
      method: init?.method,
      path: String(u).slice(apiBase.length),
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    }));
  return { f, calls };
}
const ok = (data: unknown, meta: Record<string, unknown> = {}) => ({
  status: 200,
  body: { success: true, message: 'OK', data, meta },
});

describe('SdkPatrolTechGateway — ubicaciones e invitaciones', () => {
  it('listLocations trae la dirección y listRoutes la ubicación de cada ruta', async () => {
    const { f } = fakeFetch(
      ok([
        { id: 'l1', name: 'Sede', address: ' Calle Mayor 1 ', organizationId: 'org1' },
        { id: 'l2', name: null, address: null },
      ]),
      ok({
        results: [
          { id: 'r1', name: 'Ronda', isActive: true, locationId: 'l1' },
          { id: 'r2', name: 'Vieja', isActive: false },
        ],
        count: 2,
      })
    );
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const locs = await client.listLocations('org1', 'jwt');
    const rutas = await client.listRoutes('org1', 'jwt');

    expect(locs[0]).toEqual({ id: 'l1', name: 'Sede', address: 'Calle Mayor 1' });
    expect(locs[1].address).toBeNull();
    expect(rutas.items.map((r) => r.locationId)).toEqual(['l1', null]);
  });

  it('updateLocation: PUT SOLO con nombre y/o dirección', async () => {
    const { f, calls } = fakeFetch(ok({ id: 'l1' }), ok({ id: 'l1' }));
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    // Aunque llegue algo más en tiempo de ejecución, no se envía: el backend asigna el body sin filtrar.
    await client.updateLocation(
      { id: 'l1', name: 'Oficinas', organizationId: 'otra-org' } as never,
      'jwt'
    );
    await client.updateLocation({ id: 'l1', address: 'Calle Mayor 2' }, 'jwt');

    expect(calls()).toEqual([
      { method: 'PUT', path: '/api/locations/l1', body: { name: 'Oficinas' } },
      { method: 'PUT', path: '/api/locations/l1', body: { address: 'Calle Mayor 2' } },
    ]);
  });

  it('deleteLocation: DELETE (204 sin cuerpo)', async () => {
    const { f, calls } = fakeFetch({ status: 204 });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    await client.deleteLocation('l1', 'jwt');

    expect(calls()).toEqual([{ method: 'DELETE', path: '/api/locations/l1', body: undefined }]);
  });

  it('inviteUser: POST con la whitelist exacta (nunca `id`); locationId solo con ámbito LOCATION', async () => {
    const { f, calls } = fakeFetch(
      {
        status: 201,
        body: {
          success: true,
          message: 'User created successfully',
          data: null,
          meta: { emailSent: true },
        },
      },
      {
        status: 200,
        body: { success: true, message: 'Role assigned to existing user', data: null, meta: {} },
      },
      {
        status: 201,
        body: {
          success: true,
          message: 'User created but…',
          data: null,
          meta: { emailSent: false },
        },
      }
    );
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });
    const base: NewOrgUser = {
      organizationId: 'org1',
      name: 'Luis',
      email: 'luis@x.test',
      roleType: 'VIEWER',
      roleScope: 'ORGANIZATION',
    };

    const nuevo = await client.inviteUser(
      { ...base, id: 'u-elegido', locationId: 'l9', phone: '+34' } as never,
      'jwt'
    );
    const existente = await client.inviteUser(
      { ...base, roleType: 'EDITOR', roleScope: 'LOCATION', locationId: 'l1' },
      'jwt'
    );
    const sinCorreo = await client.inviteUser(base, 'jwt');

    expect(calls()).toEqual([
      {
        method: 'POST',
        path: '/api/organizations/users',
        body: {
          organizationId: 'org1',
          name: 'Luis',
          email: 'luis@x.test',
          roleType: 'VIEWER',
          roleScope: 'ORGANIZATION',
        },
      },
      {
        method: 'POST',
        path: '/api/organizations/users',
        body: {
          organizationId: 'org1',
          name: 'Luis',
          email: 'luis@x.test',
          roleType: 'EDITOR',
          roleScope: 'LOCATION',
          locationId: 'l1',
        },
      },
      {
        method: 'POST',
        path: '/api/organizations/users',
        body: {
          organizationId: 'org1',
          name: 'Luis',
          email: 'luis@x.test',
          roleType: 'VIEWER',
          roleScope: 'ORGANIZATION',
        },
      },
    ]);
    expect(nuevo).toEqual({ cuentaNueva: true, emailEnviado: true });
    expect(existente).toEqual({ cuentaNueva: false, emailEnviado: true });
    expect(sinCorreo).toEqual({ cuentaNueva: true, emailEnviado: false });
  });
});
