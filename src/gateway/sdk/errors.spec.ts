import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '@patroltech/sdk-api';
import { PatrolTechApiError, translateBackendError } from '../../domain/backend-errors.js';
import { toPatrolTechApiError } from './errors.js';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';

const apiBase = 'http://api.test';

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Gateway cuyo backend responde siempre `response`. */
const gatewayAnswering = (response: () => Response) =>
  new SdkPatrolTechGateway({
    baseUrl: apiBase,
    fetchImpl: vi.fn<typeof fetch>(() => Promise.resolve(response())),
  });

const newCheckpoint = { name: 'Entrada', locationId: 'l1', metodo: 'qr_static' as const };

describe('errores del SDK → PatrolTechApiError (mismas semánticas que el cliente del bot)', () => {
  it('402 de límite: conserva el cuerpo entero (code, limit, currentUsage, resource, upsell) y se traduce a plan_limit', async () => {
    const body = {
      code: 'CHECKPOINT_LIMIT_REACHED',
      message: 'Has alcanzado el límite de 5 checkpoints de tu plan.',
      limit: 5,
      currentUsage: 5,
      resource: 'checkpoints',
      upsell: { tier: 'pro' },
    };
    const err = await gatewayAnswering(() => json(body, 402))
      .createCheckpoint(newCheckpoint, 'jwt')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PatrolTechApiError);
    expect(err).toMatchObject({ status: 402, path: '/api/checkpoints', body });
    expect(translateBackendError(err).kind).toBe('plan_limit');
    expect(translateBackendError(err).mensajeCliente).toContain('límite de 5 checkpoints');
  });

  it('451 de políticas pendientes → policies_pending; 403 → forbidden; 401 → session_expired', async () => {
    const withStatus = async (status: number) =>
      gatewayAnswering(() => json({ success: false, message: 'Error', meta: {} }, status))
        .setRouteActive('r1', true, 'jwt')
        .catch((e: unknown) => e);

    expect(translateBackendError(await withStatus(451)).kind).toBe('policies_pending');
    expect(translateBackendError(await withStatus(403)).kind).toBe('forbidden');
    expect(translateBackendError(await withStatus(401)).kind).toBe('session_expired');
  });

  it('423 de cuenta suspendida: el motivo dentro de `data` llega a translateBackendError', async () => {
    const body = {
      success: false,
      message: 'Suspended',
      data: { code: 'ORGANIZATION_SUSPENDED', reason: 'unpaid' },
    };
    const err = await gatewayAnswering(() => json(body, 423))
      .listRoutes('org1', 'jwt')
      .catch((e: unknown) => e);

    expect(err).toMatchObject({ status: 423, body });
    expect(translateBackendError(err).kind).toBe('account_suspended');
  });

  it('un cuerpo que no es JSON (502 de un proxy) queda como cuerpo null, igual que en el bot', async () => {
    const err = await gatewayAnswering(
      () => new Response('<html>Bad gateway</html>', { status: 502 })
    )
      .listRoutes('org1', 'jwt')
      .catch((e: unknown) => e);

    expect(err).toMatchObject({
      status: 502,
      body: null,
      message: 'PatrolTech API error 502 en /api/routes?organizationId=org1&limit=50',
    });
    expect(translateBackendError(err).kind).toBe('unavailable');
  });

  it('un cuerpo roto con content-type JSON también es PatrolTechApiError con su status (no SyntaxError)', async () => {
    const err = await gatewayAnswering(
      () =>
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'content-type': 'application/json' },
        })
    )
      .listRoutes('org1', 'jwt')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PatrolTechApiError);
    expect(err).toMatchObject({ status: 502, body: null });
    expect(translateBackendError(err).kind).toBe('unavailable');
  });

  it('lo que no es un ApiError (red, timeout) pasa tal cual', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(toPatrolTechApiError(timeout, '/api/x')).toBe(timeout);
    const mapped = toPatrolTechApiError(
      new ApiError(404, 'Not found', { message: 'Not found' }),
      '/api/x'
    );
    expect(mapped).toMatchObject({ status: 404, path: '/api/x', body: { message: 'Not found' } });
  });

  it('el timeout por llamada es configurable y corta la petición', async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
        })
    );
    const gateway = new SdkPatrolTechGateway({
      baseUrl: apiBase,
      fetchImpl: hanging,
      timeoutMs: 20,
    });

    const err = await gateway.listRoutes('org1', 'jwt').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('TimeoutError');
  });
});
