import { z } from 'zod';
import {
  backendErrorCode,
  PatrolTechApiError,
  translateBackendError,
} from '../domain/backend-errors.js';
import { FALTA_PAIS, normalizeCountry } from '../domain/country.js';
import { importe } from '../domain/money.js';
import type { FixedTextLanguage } from '../domain/language.js';
import type { PatrolTechUrls, TextPolicyOptions } from '../domain/urls.js';
import { fail, ok, type ToolResult } from '../domain/tool-result.js';
import type { PatrolTechGateway, PlanUsage } from '../gateway/index.js';
import { ROL_LABEL } from './support/roles.js';
import type { OrganizationRef } from '../context.js';
import { defineRead, type CapabilityContext, type ReadCapability, type ReadEnv } from './types.js';

const usoPlanDesc =
  'Consulta el plan de la organización y su uso frente a los límites: checkpoints usados/incluidos (y extra facturados), ubicaciones y gestores usados/límite. Límite null = sin tope. Úsala para «¿cuántos checkpoints me quedan?», «¿qué plan tengo?» o antes de proponer crear algo que cuenta para el plan.';
const contratarPlanDesc =
  'Genera el enlace de pago para contratar un plan, igual que el botón de Licencia del panel: el cliente paga en la página segura de Stripe (generar el enlace no cobra nada, así que no pide confirmación). Úsala cuando quiera contratar Pro o Business o subir de plan. Si no ha dicho plan, la recomendación es Business; si no ha dicho periodo, propón mensual; pregunta solo si duda. El cliente elige: si pide Pro o anual, dale ese. Solo un Admin de toda la organización puede contratar: si no lo es, la herramienta lo dice. Si la organización ya paga un plan, devuelve el enlace de su portal de suscripción en vez de un pago nuevo. Enterprise no tiene enlace: es a medida. Da el `enlace` completo, tal cual.';
const gestionarSuscripcionDesc =
  'Genera el enlace al portal de suscripción de Stripe de la organización (solo si ya paga): facturas, cambiar la tarjeta, datos de facturación, cancelar o cambiar de plan. Solo un Admin de toda la organización. Úsala cuando pida sus facturas, cambiar la tarjeta o gestionar la suscripción. Da el `enlace` completo, tal cual. Para BAJAR de plan, la base de conocimiento manda escalar: lo gestiona el equipo.';

const ENLACE_NO_STRIPE =
  'El panel ha devuelto un enlace de pago que no es de Stripe: no lo des. Escala al equipo.';

/**
 * ¿Es Admin de TODA la organización? Es lo que exige la API para contratar y
 * abrir el portal (rol ADMIN de organización, no de una ubicación). null si la
 * sesión no trae el rol: entonces decide la API.
 */
function esAdminDeOrganizacion(org: OrganizationRef): boolean | null {
  if (!org.roleType) return null;
  return org.roleType.toUpperCase() === 'ADMIN' && org.scope !== 'location';
}

function soloAdmin(org: OrganizationRef): ToolResult<never> {
  const rol = ROL_LABEL[org.roleType?.toUpperCase() ?? ''] ?? org.roleType ?? 'desconocido';
  const ambito = org.scope === 'location' ? ' solo de una ubicación' : '';
  return fail(
    `Solo un Admin de toda la organización «${org.name}» puede contratar, cambiar o gestionar el plan y la suscripción; este usuario es ${rol}${ambito}. ` +
      'No escales ni inventes quién es el Admin: dile que se lo pida a un Admin de su cuenta, que puede hacerlo en el panel (Licencia) o pedirme el enlace por WhatsApp desde su propio teléfono.'
  );
}

/** El enlace que devuelve el backend solo se da si es de Stripe (el mismo guardia que el panel antes de redirigir). */
function esUrlDeStripe(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'stripe.com' || host.endsWith('.stripe.com');
  } catch {
    return false;
  }
}

/** Traduce un rechazo del backend al pedir un enlace de pago; lo demás (red, timeout) sigue su camino. */
function falloEnlace(
  err: unknown,
  language: FixedTextLanguage,
  policy: TextPolicyOptions
): ToolResult<never> {
  if (err instanceof PatrolTechApiError) {
    return fail(translateBackendError(err, language, policy).mensajeCliente);
  }
  throw err;
}

/** Los enlaces de pago: la vuelta desde Stripe es la página Licencia del panel. */
function billingLinks(
  gateway: PatrolTechGateway,
  policy: { urls: PatrolTechUrls; upsell: boolean }
) {
  const licensePageUrl = policy.urls.license;
  const checkoutSuccessUrl = `${licensePageUrl}/callback?status=success`;
  const checkoutCancelUrl = `${licensePageUrl}/callback?status=cancel`;

  async function enlacePortal(ctx: CapabilityContext): Promise<string | ToolResult<never>> {
    let enlace: string;
    try {
      enlace = await gateway.createCustomerPortalLink(ctx.org.orgId, licensePageUrl, ctx.token);
    } catch (err) {
      return falloEnlace(err, ctx.language, policy);
    }
    return esUrlDeStripe(enlace) ? enlace : fail(ENLACE_NO_STRIPE);
  }

  /** Quien ya paga cambia de plan en su portal de suscripción, no con un pago nuevo. */
  async function portalDeQuienYaPaga(
    ctx: CapabilityContext,
    planActual: string
  ): Promise<ToolResult<unknown>> {
    const enlace = await enlacePortal(ctx);
    if (typeof enlace !== 'string') return enlace;
    return ok(
      { enlace, tipo: 'portal_suscripcion', planActual },
      {
        avisos: [
          `La organización ya paga el plan ${planActual}: no se contrata otro (serían dos cobros). Este enlace es su portal de suscripción de Stripe, donde cambia de plan, ve sus facturas y cambia la tarjeta. Si en el portal no le aparece el cambio de plan, se hace en el panel: Licencia → «Pasar a {plan}» (se aplica al momento y se cobra la parte proporcional).`,
        ],
      }
    );
  }

  async function contratar(
    ctx: CapabilityContext,
    args: { plan: 'pro' | 'business' | 'enterprise'; periodo?: 'mensual' | 'anual'; pais?: string }
  ): Promise<ToolResult<unknown>> {
    if (args.plan === 'enterprise') {
      return ok(
        { plan: 'Enterprise', aMedida: true },
        {
          avisos: [
            'Enterprise es una oferta a medida que gestiona el equipo: no tiene enlace de pago. Antes de ofrecerlo, comprueba con consultar_precios (checkpoints incluidos y precio del extra) y consultar_uso_plan (sus límites y uso) si Business le cubre, sin dar límites de memoria: si le cubre, ofrécele Business con su enlace. Si de verdad necesita Enterprise, ofrécele una llamada con el equipo: acuerda día y hora y usa escalar_a_humano con `cita` (y programar_recordatorio).',
          ],
        }
      );
    }
    if (esAdminDeOrganizacion(ctx.org) === false) return soloAdmin(ctx.org);

    const orgId = ctx.org.orgId;
    const uso = await gateway.getPlanUsage(orgId, ctx.token);
    // NUNCA un checkout para quien ya paga: crearía una segunda suscripción cobrando a la vez.
    if (uso.pagaSuscripcion) return portalDeQuienYaPaga(ctx, uso.plan);
    if (!args.periodo) {
      return fail(
        'Falta el periodo: si no lo ha dicho, propón mensual; pregunta solo si duda. Vuelve a llamarla con periodo mensual (o anual si lo pide o quiere ahorrar: el anual son 10 mensualidades, 2 meses gratis).'
      );
    }

    // El backend decide la moneda; aquí solo se le pasa el país (el que diga el cliente o el del contexto).
    const pais = normalizeCountry(args.pais) ?? ctx.country;
    if (!pais) return fail(FALTA_PAIS);
    const plan = (await gateway.getPlans(orgId, ctx.token, pais)).find(
      (p) => p.identificador === args.plan
    );
    if (!plan) {
      return fail(
        `El plan ${args.plan} no está disponible ahora mismo en el panel: no des precio ni enlace. Escala al equipo.`
      );
    }
    const anual = args.periodo === 'anual';
    let enlace: string;
    try {
      enlace = await gateway.createCheckoutLink(
        orgId,
        {
          tierId: plan.tierId,
          interval: anual ? 'year' : 'month',
          successUrl: checkoutSuccessUrl,
          cancelUrl: checkoutCancelUrl,
          country: pais,
        },
        ctx.token
      );
    } catch (err) {
      // Si no se sabía que ya paga, lo dice el backend al negarse a abrir otro checkout.
      if (err instanceof PatrolTechApiError && backendErrorCode(err) === 'ALREADY_SUBSCRIBED') {
        return portalDeQuienYaPaga(ctx, uso.plan);
      }
      return falloEnlace(err, ctx.language, policy);
    }
    if (!esUrlDeStripe(enlace)) return fail(ENLACE_NO_STRIPE);
    const precios = anual ? plan.anual : plan.mensual;
    const cada = anual ? 'al año' : 'al mes';
    return ok(
      {
        enlace,
        plan: plan.nombre,
        periodo: args.periodo,
        precio: `${importe(precios.base, plan.moneda)} ${cada}`,
        moneda: plan.moneda,
        checkpointsIncluidos: plan.checkpointsIncluidos,
        checkpointExtra: `${importe(precios.extra, plan.moneda)} ${cada} por cada checkpoint por encima de ${plan.checkpointsIncluidos}`,
      },
      {
        avisos: [
          'Precio y moneda son los que cobra Stripe a esta organización (la moneda la decide el sistema por su país): dalos tal cual. Generar el enlace no cobra nada: paga en la página segura de Stripe, donde ve el total (con impuestos y, si ya tiene más checkpoints de los incluidos, los extra) antes de confirmar. El enlace caduca a los 45 minutos: si caduca, se genera otro. Al pagar, el plan se activa solo.',
        ],
      }
    );
  }

  async function gestionar(ctx: CapabilityContext): Promise<ToolResult<unknown>> {
    if (esAdminDeOrganizacion(ctx.org) === false) return soloAdmin(ctx.org);
    const uso = await gateway.getPlanUsage(ctx.org.orgId, ctx.token);
    const enlace = await enlacePortal(ctx);
    if (typeof enlace !== 'string') {
      // Sin cliente de Stripe (nunca ha pagado) el backend no abre el portal.
      return uso.pagaSuscripcion === false
        ? fail(
            `La organización no tiene suscripción de pago (plan ${uso.plan}): no hay facturas ni tarjeta que gestionar. Si quiere contratar un plan, usa enlace_contratar_plan.`
          )
        : enlace;
    }
    return ok({ enlace, planActual: uso.plan });
  }

  return { contratar, gestionar };
}

/**
 * Sin upsell (MCP) solo el consumo frente a los límites: ni el nombre del plan,
 * ni su estado de pago, ni los checkpoints extra facturados.
 */
function usoSinFacturacion(uso: NonNullable<PlanUsage['uso']>) {
  const { usados, incluidos } = uso.checkpoints;
  return { ...uso, checkpoints: { usados, incluidos } };
}

/** Plan y suscripción: uso frente a los límites y enlaces de pago de Stripe. */
export function planReads({ gateway, urls, upsell }: ReadEnv): ReadCapability[] {
  const enlaces = billingLinks(gateway, { urls, upsell });
  return [
    defineRead({
      name: 'consultar_uso_plan',
      description: usoPlanDesc,
      params: {},
      call: async ({ org, token }) => {
        const usage = await gateway.getPlanUsage(org.orgId, token);
        return ok(upsell ? usage : { uso: usage.uso && usoSinFacturacion(usage.uso) });
      },
    }),
    defineRead({
      name: 'enlace_contratar_plan',
      description: contratarPlanDesc,
      params: {
        plan: z
          .enum(['pro', 'business', 'enterprise'])
          .describe('Plan que quiere contratar (si no lo ha dicho, la recomendación es business)'),
        periodo: z
          .enum(['mensual', 'anual'])
          .optional()
          .describe(
            'Facturación mensual o anual (anual = 10 mensualidades, 2 meses gratis). Si no lo ha dicho, propón mensual; pregunta solo si duda. Anual solo si lo pide o pregunta cómo ahorrar.'
          ),
        pais: z
          .string()
          .optional()
          .describe(
            'Código ISO-2 del país del cliente (p. ej. MX, ES). Solo si el cliente lo ha dicho o si la herramienta te lo pide; si no, omítelo.'
          ),
      },
      call: async (ctx, args) => enlaces.contratar(ctx, args),
    }),
    defineRead({
      name: 'enlace_gestionar_suscripcion',
      description: gestionarSuscripcionDesc,
      params: {},
      call: async (ctx) => enlaces.gestionar(ctx),
    }),
  ];
}
