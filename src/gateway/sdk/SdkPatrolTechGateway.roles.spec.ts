/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/require-await -- stubs de fetch portados del bot: la URL y el cuerpo que reciben son siempre strings y los stubs son async sin await */
import { describe, it, expect, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';

const apiBase = 'http://api.test';

/** El backend responde `application/json`: el SDK solo parsea JSON con esa cabecera (el bot lo hacía a ciegas). */
const apiResponse = (body: BodyInit | null, init?: ResponseInit): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/json' } });

/** fetch falso que devuelve, en orden, los cuerpos y status dados; apunta método, ruta y cuerpo. */
function fakeFetch(...responses: { status: number; body?: unknown }[]) {
  const f = vi.fn<typeof fetch>(async () => {
    const r = responses.shift() ?? { status: 200, body: {} };
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

describe('SdkPatrolTechGateway — roles de usuarios del panel', () => {
  it('listOrgUsers trae el id de cada rol (lo necesitan cambiar y quitar acceso)', async () => {
    const { f } = fakeFetch({
      status: 200,
      body: {
        results: [
          {
            id: 'u1',
            name: 'Marta',
            email: 'm@x.test',
            UserRoles: [
              { id: 'r1', roleType: 'ADMIN', roleScope: 'ORGANIZATION', scopeId: 'org1' },
            ],
          },
        ],
        count: 1,
        totalPages: 1,
      },
    });
    const users = await new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f }).listOrgUsers(
      'org1',
      'jwt'
    );
    expect(users[0].roles).toEqual([
      { id: 'r1', rol: 'ADMIN', ambito: 'ORGANIZATION', scopeId: 'org1' },
    ]);
  });

  it('updateUserRole: PUT /api/user-roles/:id SOLO con roleType', async () => {
    const { f, calls } = fakeFetch({ status: 200, body: { id: 'r 1', roleType: 'EDITOR' } });
    await new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f }).updateUserRole(
      { userRoleId: 'r 1', roleType: 'EDITOR' },
      'jwt'
    );
    expect(calls()).toEqual([
      { method: 'PUT', path: '/api/user-roles/r%201', body: { roleType: 'EDITOR' } },
    ]);
  });

  it('deleteUserRole: DELETE /api/user-roles/:id (204 sin cuerpo)', async () => {
    const { f, calls } = fakeFetch({ status: 204 });
    await new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f }).deleteUserRole('r1', 'jwt');
    expect(calls()).toEqual([{ method: 'DELETE', path: '/api/user-roles/r1', body: undefined }]);
  });
});
