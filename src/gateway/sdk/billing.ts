import {
  createCheckoutSession,
  createCustomerPortalSession,
  getCreateCheckoutSessionUrl,
  getCreateCustomerPortalSessionUrl,
  getGetLicenseInfoUrl,
  getGetPaymentPricesUrl,
  getLicenseInfo,
  getPaymentPrices,
  type GetPaymentPricesParams,
  type LicenseUsage,
  type PaymentPricesResponseItem,
  type PlanPricing,
} from '@patroltech/sdk-api';
import type { CheckoutLinkInput, PaidPlan, PlanUsage } from '../types/index.js';
import type { SdkTransport } from './transport.js';

/**
 * Entrada de `GET /api/payments/prices`.
 * `currency` es la de la organización (`EUR`/`USD`); `pricing` es null para Free o
 * un plan fuera del price book (el `allOf` nullable que genera orval pierde el null)
 * e importa en céntimos, por moneda en minúsculas.
 */
function toPaidPlan(p: PaymentPricesResponseItem): PaidPlan | null {
  const moneda = p.currency.toLowerCase();
  const pr: PlanPricing | null = p.pricing;
  if (!pr) return null;
  const importe = (porMoneda: Record<string, number>): number | null =>
    typeof porMoneda[moneda] === 'number' ? porMoneda[moneda] / 100 : null;
  const [mb, me, ab, ae] = [
    importe(pr.monthly.base),
    importe(pr.monthly.extra),
    importe(pr.yearly.base),
    importe(pr.yearly.extra),
  ];
  if (mb === null || me === null || ab === null || ae === null) return null;
  return {
    tierId: p.tierId,
    nombre: p.tierName,
    identificador: p.tierIdentifier,
    moneda: p.currency.toUpperCase(),
    checkpointsIncluidos: pr.includedCheckpoints,
    mensual: { base: mb, extra: me },
    anual: { base: ab, extra: ae },
  };
}

/** El backend usa null o -1 para «sin tope». */
function limitOrNull(limit: number | null): number | null {
  return limit === null || limit < 0 ? null : limit;
}

export async function getPlanUsage(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<PlanUsage> {
  const id = accountId;
  const body = await t.data(token, getGetLicenseInfoUrl(id), (init) => getLicenseInfo(id, init));
  // `usage` puede ser null (el `allOf` nullable que genera orval pierde el null).
  const u: LicenseUsage | null = body.usage;
  return {
    plan: body.tier.name,
    estadoLicencia: body.license.status,
    // Si ya paga una suscripción vigente (contrato 1.2.0), sin ningún id del
    // proveedor. Un backend anterior no lo manda: null, y decide el 409
    // `ALREADY_SUBSCRIBED` del checkout.
    pagaSuscripcion: body.hasActiveSubscription ?? null,
    uso: u
      ? {
          checkpoints: {
            usados: u.checkpoints.used,
            incluidos: limitOrNull(u.checkpoints.included),
            extraFacturados: u.checkpoints.extra,
          },
          ubicaciones: { usadas: u.locations.used, limite: limitOrNull(u.locations.limit) },
          gestores: { usados: u.managers.used, limite: limitOrNull(u.managers.limit) },
        }
      : null,
  };
}

export async function getPlans(
  t: SdkTransport,
  accountId: string | null,
  token: string | null,
  country?: string | null
): Promise<PaidPlan[]> {
  // Endpoint público. Con `organizationId` los importes salen
  // en SU moneda, la misma con la que cobra el checkout; `country` evita que, sin dirección de
  // facturación, la moneda salga de la IP del servidor que llama.
  const params: GetPaymentPricesParams = {
    ...(accountId ? { organizationId: accountId } : {}),
    ...(country ? { country } : {}),
  };
  const body = await t.data(token, getGetPaymentPricesUrl(params), (init) =>
    getPaymentPrices(params, init)
  );
  return body.map(toPaidPlan).filter((p): p is PaidPlan => p !== null);
}

/**
 * La organización va en la query `organizationId` (la API la necesita para comprobar
 * el rol y los esquemas del body no la llevan). El contrato también la acepta en la
 * cabecera `x-organization-id`, pero la query entra por `params` de la función
 * generada y sale igual en la URL que nombra la ruta en el error.
 */
export async function createCheckoutLink(
  t: SdkTransport,
  accountId: string,
  input: CheckoutLinkInput,
  token: string
): Promise<string> {
  const params = { organizationId: accountId };
  const body = await t.data(token, getCreateCheckoutSessionUrl(params), (init) =>
    createCheckoutSession(input, params, init)
  );
  return body.sessionUrl;
}

export async function createCustomerPortalLink(
  t: SdkTransport,
  accountId: string,
  returnUrl: string,
  token: string
): Promise<string> {
  const params = { organizationId: accountId };
  const body = await t.data(token, getCreateCustomerPortalSessionUrl(params), (init) =>
    createCustomerPortalSession({ returnUrl }, params, init)
  );
  return body.sessionUrl;
}
