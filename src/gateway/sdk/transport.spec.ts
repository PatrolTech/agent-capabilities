import { sdkFetch } from '@patroltech/sdk-api';
import { describe, it, expect, vi } from 'vitest';
import { PatrolTechApiError } from '../../domain/backend-errors.js';
import { noopLogger } from '../../ports/Logger.js';
import { SdkTransport, callSdk, type SdkResponse } from './transport.js';

const respuesta = (): Response =>
  new Response(JSON.stringify({ success: true, message: 'OK', data: [], meta: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('SdkTransport · defaultHeaders', () => {
  it('sin token (endpoint público) una Authorization por defecto no se envía', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(respuesta()));
    const transport = new SdkTransport({
      baseUrl: 'http://api.test',
      fetchImpl,
      timeoutMs: 1000,
      logger: noopLogger,
      defaultHeaders: () => ({ Authorization: 'Bearer otro', 'X-Request-Id': 'r-1' }),
    });

    await transport.data(null, '/api/x', (init) => sdkFetch<SdkResponse>('/api/x', init));

    const headers = fetchImpl.mock.calls[0][1]!.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(headers['X-Request-Id']).toBe('r-1');
  });
});

describe('callSdk', () => {
  it('llama con el token de la llamada y las cabeceras por defecto, sin su Authorization', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(respuesta()));

    await callSdk(
      {
        baseUrl: 'http://api.test',
        fetchImpl,
        timeoutMs: 1000,
        defaultHeaders: () => ({ authorization: 'Bearer otro', 'X-Agent-Client': 'c-1' }),
      },
      'token-del-usuario',
      '/api/x',
      (init) => sdkFetch<SdkResponse>('/api/x', init)
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect((url as string | URL).toString()).toBe('http://api.test/api/x');
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-del-usuario');
    expect(headers.authorization).toBeUndefined();
    expect(headers['X-Agent-Client']).toBe('c-1');
  });

  it('un rechazo del backend sale como PatrolTechApiError con status, ruta y cuerpo', async () => {
    const body = { success: false, message: 'Too many', meta: { errorCode: 'RATE_LIMITED' } };
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        })
      )
    );

    const call = callSdk(
      { baseUrl: 'http://api.test', fetchImpl, timeoutMs: 1000 },
      't',
      '/api/x',
      (init) => sdkFetch<SdkResponse>('/api/x', init)
    );

    await expect(call).rejects.toBeInstanceOf(PatrolTechApiError);
    await expect(call).rejects.toMatchObject({ status: 429, path: '/api/x', body });
  });

  it('un fallo de red sale tal cual', async () => {
    const network = new TypeError('fetch failed');
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(network));

    await expect(
      callSdk({ baseUrl: 'http://api.test', fetchImpl, timeoutMs: 1000 }, 't', '/api/x', (init) =>
        sdkFetch<SdkResponse>('/api/x', init)
      )
    ).rejects.toBe(network);
  });
});
