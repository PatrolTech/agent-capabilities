import { describe, it, expect, vi } from 'vitest';
import { configureApiSdk } from '@patroltech/sdk-api';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';

/**
 * Aislamiento por petición con UNA instancia compartida (el caso del servidor
 * MCP multi-tenant): dos llamadas a la vez con tokens distintos llevan cada una
 * su `Authorization` y reciben su propia respuesta, aunque se crucen en el tiempo.
 */

const apiBase = 'http://api.test';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Responde con un vigilante que se llama como el token que trae la petición, tras `retraso(token)` ms. */
function backendQueRespondeConElToken(retraso: (token: string) => number) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string | undefined>;
    const token = (headers.Authorization ?? '').replace(/^Bearer /, '');
    await sleep(retraso(token));
    const body = {
      success: true,
      message: 'OK',
      data: {
        results: [{ name: `vigilante-${token}`, lastScanDate: null, status: 'active' }],
        count: 1,
        totalPages: 1,
      },
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('SdkPatrolTechGateway · concurrencia', () => {
  it('una instancia, dos llamadas a la vez con tokens a y b (escalonadas): cada una con el suyo', async () => {
    // El singleton global del SDK no interviene: si se usara, saldría «global».
    configureApiSdk({ baseUrl: 'http://global.test', getAccessToken: () => 'global' });
    // `a` sale primero pero tarda más: `b` se resuelve en medio de `a`.
    const fetchImpl = backendQueRespondeConElToken((token) => (token === 'a' ? 30 : 0));
    const gateway = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl });

    const deA = gateway.getPatrollerActivity('org-a', 'a');
    await sleep(5);
    const deB = gateway.getPatrollerActivity('org-b', 'b');
    const [ra, rb] = await Promise.all([deA, deB]);

    expect(ra.items.map((p) => p.name)).toEqual(['vigilante-a']);
    expect(rb.items.map((p) => p.name)).toEqual(['vigilante-b']);
    const enviadas = fetchImpl.mock.calls.map(([url, init]) => ({
      url: url as string,
      auth: (init?.headers as Record<string, string>).Authorization,
    }));
    expect(enviadas).toEqual([
      { url: `${apiBase}/api/patrollers?organizationId=org-a&limit=100`, auth: 'Bearer a' },
      { url: `${apiBase}/api/patrollers?organizationId=org-b&limit=100`, auth: 'Bearer b' },
    ]);
  });

  it('muchas a la vez (10 tokens intercalados): ninguna cabecera ni respuesta se cruza', async () => {
    const fetchImpl = backendQueRespondeConElToken((token) => (Number(token.slice(1)) % 3) * 5);
    const gateway = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl });
    const tokens = Array.from({ length: 10 }, (_, i) => `t${i}`);

    const resultados = await Promise.all(
      tokens.map((tk) => gateway.getPatrollerActivity(`org-${tk}`, tk))
    );

    expect(resultados.map((r) => r.items[0]?.name)).toEqual(tokens.map((tk) => `vigilante-${tk}`));
    for (const [url, init] of fetchImpl.mock.calls) {
      const org = new URL(url as string).searchParams.get('organizationId');
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${org?.replace('org-', '')}`
      );
    }
  });
});
