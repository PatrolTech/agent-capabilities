import { describe, expect, it, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';

/**
 * `@patroltech/sdk-api` ya codifica los parámetros de ruta y de query: el gateway
 * pasa los ids tal cual y cada carácter especial llega a la URL codificado UNA sola
 * vez (`/` → `%2F`; el espacio, `%20` en la ruta y `+` en la query, la de
 * `URLSearchParams`), nunca dos (`%252F`, `%2520`).
 */

const apiBase = 'http://api.test';

/** Gateway que anota la URL exacta de cada petición; responde 404 (no hace falta más). */
function recordingGateway() {
  const urls: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url.slice(apiBase.length));
    return Promise.resolve(
      new Response(JSON.stringify({ success: false, message: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    );
  });
  return { gateway: new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl }), urls };
}

const ignore = () => undefined;

describe.each([
  ['una barra', 'a/b', 'a%2Fb', 'a%2Fb'],
  ['espacios', 'a b c', 'a%20b%20c', 'a+b+c'],
])('ids con %s llegan a la URL codificados una sola vez', (_caso, id, encoded, inQuery) => {
  it('ruta con un parámetro (getRouteDetails)', async () => {
    const { gateway, urls } = recordingGateway();

    await gateway.getRouteDetails(id, 'jwt').catch(ignore);

    expect(urls).toEqual([`/api/routes/${encoded}/details`]);
  });

  it('ruta con dos parámetros (addCheckpointToRoute)', async () => {
    const { gateway, urls } = recordingGateway();

    await gateway.addCheckpointToRoute(id, `${id}-cp`, 1, 'jwt').catch(ignore);

    expect(urls).toEqual([`/api/routes/${encoded}/checkpoints/${encoded}-cp`]);
  });

  it('ruta y query del SDK (getIncidentDetail)', async () => {
    const { gateway, urls } = recordingGateway();

    await gateway
      .getIncidentDetail({ incidentId: id, organizationId: `org ${id}`, locationId: null }, 'jwt')
      .catch(ignore);

    expect(urls).toEqual([
      `/api/features/incident-reporting/incidents/${encoded}?organizationId=org+${inQuery}`,
    ]);
  });

  it('escritura con ruta y query del SDK (updateIncidentStatus)', async () => {
    const { gateway, urls } = recordingGateway();

    await gateway
      .updateIncidentStatus(
        { incidentId: id, organizationId: 'o1', locationId: id, estado: 'RESOLVED' },
        'jwt'
      )
      .catch(ignore);

    expect(urls).toEqual([
      `/api/features/incident-reporting/incidents/${encoded}/status?locationId=${inQuery}`,
    ]);
  });

  it('nunca aparece una doble codificación', async () => {
    const { gateway, urls } = recordingGateway();

    await gateway.getRouteDetails(id, 'jwt').catch(ignore);
    await gateway.addCheckpointToRoute(id, id, 1, 'jwt').catch(ignore);
    await gateway
      .getIncidentDetail({ incidentId: id, organizationId: id, locationId: null }, 'jwt')
      .catch(ignore);

    expect(urls).toHaveLength(3);
    for (const url of urls) expect(url).not.toMatch(/%25/);
  });
});
