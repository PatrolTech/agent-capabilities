/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/require-await -- stubs de fetch portados del bot: la URL y el cuerpo que reciben son siempre strings y los stubs son async sin await */
import { describe, it, expect, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';
import { PatrolTechApiError } from '../../domain/backend-errors.js';

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

/** Pricing del catálogo de precios, en céntimos y por moneda. */
const pricing = (
  base: { eur: number; usd: number },
  extra: { eur: number; usd: number },
  incluidos: number
) => ({
  plan: 'x',
  includedCheckpoints: incluidos,
  monthly: { base, extra },
  yearly: {
    base: { eur: base.eur * 10, usd: base.usd * 10 },
    extra: { eur: extra.eur * 10, usd: extra.usd * 10 },
  },
  monthsBilledYearly: 10,
});

describe('SdkPatrolTechGateway — pagos', () => {
  it('getPlans: pide los precios de la organización y deja solo los planes de pago, en SU moneda y en unidades', async () => {
    const { f, calls } = fakeFetch(200, [
      {
        tierId: 't-free',
        tierName: 'Free',
        tierIdentifier: 'free',
        price: 0,
        currency: 'EUR',
        billingInterval: 'month',
        features: {},
        limits: {},
        pricing: null,
      },
      {
        tierId: 't-pro',
        tierName: 'Pro',
        tierIdentifier: 'pro',
        price: 11,
        currency: 'USD',
        billingInterval: 'month',
        features: {},
        limits: {},
        pricing: pricing({ eur: 1100, usd: 1100 }, { eur: 300, usd: 300 }, 12),
      },
      {
        tierId: 't-bus',
        tierName: 'Business',
        tierIdentifier: 'business',
        price: 25,
        currency: 'USD',
        billingInterval: 'month',
        features: {},
        limits: {},
        pricing: pricing({ eur: 2200, usd: 2500 }, { eur: 400, usd: 400 }, 48),
      },
    ]);
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const plans = await client.getPlans('org1', 'jwt');

    expect(calls()).toEqual([
      { method: 'GET', path: '/api/payments/prices?organizationId=org1', body: undefined },
    ]);
    expect(plans).toEqual([
      {
        tierId: 't-pro',
        nombre: 'Pro',
        identificador: 'pro',
        moneda: 'USD',
        checkpointsIncluidos: 12,
        mensual: { base: 11, extra: 3 },
        anual: { base: 110, extra: 30 },
      },
      {
        tierId: 't-bus',
        nombre: 'Business',
        identificador: 'business',
        moneda: 'USD',
        checkpointsIncluidos: 48,
        mensual: { base: 25, extra: 4 },
        anual: { base: 250, extra: 40 },
      },
    ]);
  });

  it('getPlans sin organización ni token (prospecto): catálogo público con el país, sin cabecera Authorization', async () => {
    const { f, calls } = fakeFetch(200, [
      {
        tierId: 't-pro',
        tierName: 'Pro',
        tierIdentifier: 'pro',
        price: 11,
        currency: 'USD',
        billingInterval: 'month',
        features: {},
        limits: {},
        pricing: pricing({ eur: 1100, usd: 1100 }, { eur: 300, usd: 300 }, 12),
      },
    ]);
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const plans = await client.getPlans(null, null, 'MX');

    expect(calls()).toEqual([
      { method: 'GET', path: '/api/payments/prices?country=MX', body: undefined },
    ]);
    const headers = (f.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers).not.toHaveProperty('Authorization');
    expect(plans).toEqual([
      {
        tierId: 't-pro',
        nombre: 'Pro',
        identificador: 'pro',
        moneda: 'USD',
        checkpointsIncluidos: 12,
        mensual: { base: 11, extra: 3 },
        anual: { base: 110, extra: 30 },
      },
    ]);
  });

  it('getPlans con organización y país: los dos en la query', async () => {
    const { f, calls } = fakeFetch(200, []);
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    await client.getPlans('org1', 'jwt', 'MX');

    expect(calls()).toEqual([
      {
        method: 'GET',
        path: '/api/payments/prices?organizationId=org1&country=MX',
        body: undefined,
      },
    ]);
  });

  it('createCheckoutLink: POST con la organización en la query (la API comprueba con ella el rol) y el cuerpo del contrato', async () => {
    const { f, calls } = fakeFetch(200, {
      sessionUrl: 'https://checkout.stripe.com/c/pay/cs_1',
      sessionId: 'cs_1',
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });
    const input = {
      tierId: 't-pro',
      interval: 'year' as const,
      successUrl: 'https://d/ok',
      cancelUrl: 'https://d/ko',
    };

    const url = await client.createCheckoutLink('org1', input, 'jwt');

    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_1');
    expect(calls()).toEqual([
      { method: 'POST', path: '/api/payments/checkout-session?organizationId=org1', body: input },
    ]);
  });

  it('createCustomerPortalLink: POST con `returnUrl` y la organización en la query', async () => {
    const { f, calls } = fakeFetch(200, { sessionUrl: 'https://billing.stripe.com/p/session/1' });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const url = await client.createCustomerPortalLink(
      'org1',
      'https://dashboard.patroltech.online/license',
      'jwt'
    );

    expect(url).toBe('https://billing.stripe.com/p/session/1');
    expect(calls()).toEqual([
      {
        method: 'POST',
        path: '/api/payments/customer-portal?organizationId=org1',
        body: { returnUrl: 'https://dashboard.patroltech.online/license' },
      },
    ]);
  });

  it('un rechazo del backend llega como PatrolTechApiError con su cuerpo', async () => {
    const { f } = fakeFetch(403, {
      code: 'INSUFFICIENT_ORGANIZATION_ROLE',
      message: 'Insufficient permissions',
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    await expect(
      client.createCheckoutLink(
        'org1',
        { tierId: 't', interval: 'month', successUrl: 'https://a/b', cancelUrl: 'https://a/c' },
        'jwt'
      )
    ).rejects.toBeInstanceOf(PatrolTechApiError);
  });

  it('getPlanUsage: pagaSuscripcion es null porque el contrato público no lo expone', async () => {
    const { f } = fakeFetch(200, {
      license: { status: 'active' },
      tier: { name: 'Pro' },
      usage: null,
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    expect((await client.getPlanUsage('org1', 'jwt')).pagaSuscripcion).toBeNull();
  });
});
