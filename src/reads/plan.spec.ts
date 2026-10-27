import { describe, it, expect } from 'vitest';
import { buildCatalog } from '../catalog/buildCatalog.js';
import { PatrolTechApiError } from '../domain/backend-errors.js';
import {
  capabilityContext,
  FakePatrolTechGateway,
  readHarness,
  runRead,
} from '../testing/index.js';
import { readCapabilities } from './index.js';
import { resolveOrganization } from './organization.js';
import type { OrganizationRef } from '../context.js';
import type { CapabilityContext } from './types.js';

const admin: OrganizationRef = {
  orgId: 'org-a',
  name: 'Acme Seguridad',
  roleType: 'ADMIN',
  scope: 'organization',
};
const orgB: OrganizationRef = { orgId: 'org-b', name: 'Beta Vigilancia' };

/** País del cliente: el del teléfono en WhatsApp (ES) o ninguno (Telegram). */
function setup(organizations: OrganizationRef[] = [admin], country: string | null = 'ES') {
  return readHarness({ ctx: { organizations, country } });
}

/** El contexto con la organización que nombra el usuario, resuelta como lo hace el consumidor. */
function conOrganizacion(ctx: CapabilityContext, nombre: string): CapabilityContext {
  const org = resolveOrganization(ctx, nombre);
  if ('error' in org) throw new Error(org.error);
  return { ...ctx, org };
}

const pagando = (pt: FakePatrolTechGateway): void => {
  pt.planUsage = { ...pt.planUsage, plan: 'Pro', pagaSuscripcion: true };
};

describe('consultar_uso_plan', () => {
  it('devuelve plan y uso de la organización elegida', async () => {
    const { run, gateway, ctx } = setup([{ orgId: 'org-a', name: 'Acme Seguridad' }, orgB]);

    const out = await run('consultar_uso_plan', {}, conOrganizacion(ctx, 'Beta'));

    expect(out).toMatchObject({
      ok: true,
      data: { plan: 'Free', uso: { checkpoints: { usados: 7, incluidos: 7 } } },
    });
    expect(gateway.calls).toEqual(['org-b']);
  });
});

describe('consultar_uso_plan sin upsell (canal MCP)', () => {
  it('da el uso frente a los límites sin nombre de plan, estado de licencia ni suscripción', async () => {
    const gateway = new FakePatrolTechGateway();
    const reads = readCapabilities({ gateway, upsell: false });

    const out = await runRead(reads, 'consultar_uso_plan', capabilityContext());

    expect(out).toEqual({
      ok: true,
      data: {
        uso: {
          ...gateway.planUsage.uso,
          // Lo que se factura de más es un concepto de precio: el límite y el consumo bastan.
          checkpoints: { usados: 7, incluidos: 7 },
        },
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/plan|licen|suscrip/i);
  });

  it('con upsell (el bot) conserva el plan, el estado, la suscripción y los extra facturados', async () => {
    const { run, gateway } = setup();

    const out = await run('consultar_uso_plan', {});

    // El bot recibe lo mismo que antes del canal MCP: la respuesta del backend entera.
    expect(out.data).toEqual(gateway.planUsage);
    expect(out.data).toMatchObject({
      plan: 'Free',
      estadoLicencia: 'active',
      pagaSuscripcion: false,
      uso: { checkpoints: { extraFacturados: 0 } },
    });
  });

  it('la descripción del bot sigue anunciando el plan (el MCP describe con el resumen del catálogo)', () => {
    const read = readCapabilities({ gateway: new FakePatrolTechGateway() }).find(
      (r) => r.name === 'consultar_uso_plan'
    );

    expect(read?.description).toContain('el plan de la organización');
    expect(read?.description).toContain('(y extra facturados)');
    expect(read?.description).toContain('«¿qué plan tengo?»');
  });
});

describe('idioma del cliente en los errores', () => {
  it('también en una lectura del canal MCP: consultar_uso_plan falla en inglés', async () => {
    const gateway = new FakePatrolTechGateway();
    gateway.getPlanUsage = () => Promise.reject(new Error('boom'));
    const { reads } = buildCatalog({ gateway }, { channel: 'mcp' });

    const out = await runRead(
      reads.map((r) => r.read),
      'consultar_uso_plan',
      capabilityContext({ language: 'en' })
    );

    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining("the dashboard isn't responding right now") as unknown,
    });
  });

  it.each([
    ['en', "the dashboard isn't responding right now"],
    ['fr', 'le tableau de bord ne répond pas'],
  ] as const)(
    'un fallo inesperado de una lectura se explica en el idioma del contexto (%s)',
    async (language, texto) => {
      const { run, gateway, ctx } = setup();
      gateway.paymentLinkError = new Error('boom');

      const out = await run(
        'enlace_contratar_plan',
        { plan: 'pro', periodo: 'mensual' },
        {
          ...ctx,
          language,
        }
      );

      expect(out).toMatchObject({ ok: false, error: expect.stringContaining(texto) as unknown });
    }
  );

  it('el rechazo del backend al pedir el enlace de pago también sale en su idioma', async () => {
    const { run, gateway, ctx } = setup();
    gateway.paymentLinkError = new PatrolTechApiError(403, '/api/payments/checkout-session', {
      code: 'INSUFFICIENT_ORGANIZATION_ROLE',
    });

    const out = await run(
      'enlace_contratar_plan',
      { plan: 'pro', periodo: 'mensual' },
      {
        ...ctx,
        language: 'en',
      }
    );

    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining("doesn't have permission") as unknown,
    });
  });
});

describe('enlace_contratar_plan', () => {
  it('organización que no paga: crea el checkout del plan con la vuelta a Licencia y da enlace y precio del backend', async () => {
    const { run, gateway } = setup();

    const out = await run('enlace_contratar_plan', { plan: 'pro', periodo: 'mensual' });

    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({
      enlace: gateway.checkoutUrl,
      plan: 'Pro',
      periodo: 'mensual',
      precio: '11 € al mes',
      moneda: 'EUR',
      checkpointsIncluidos: 12,
    });
    expect(gateway.paymentLinks).toEqual([
      {
        op: 'checkout',
        accountId: 'org-a',
        input: {
          tierId: 'tier-pro',
          interval: 'month',
          successUrl: 'https://dashboard.patroltech.online/license/callback?status=success',
          cancelUrl: 'https://dashboard.patroltech.online/license/callback?status=cancel',
          // El país del contexto va al backend: si no, la moneda saldría de la IP del servidor.
          country: 'ES',
        },
      },
    ]);
    // La sesión de checkout dura 45 minutos.
    expect(out.avisos?.join(' ')).toMatch(/caduca a los 45 minutos/);
    expect(out.avisos?.join(' ')).not.toMatch(/24 h/);
  });

  it('anual: intervalo year y precio anual en la moneda de la organización', async () => {
    const { run, gateway } = setup();
    gateway.plans = gateway.plans.map((p) =>
      p.identificador === 'business'
        ? { ...p, moneda: 'USD', mensual: { base: 25, extra: 4 }, anual: { base: 250, extra: 40 } }
        : p
    );

    const out = await run('enlace_contratar_plan', { plan: 'business', periodo: 'anual' });

    expect(out.data).toMatchObject({ plan: 'Business', precio: '250 US$ al año', moneda: 'USD' });
    expect(gateway.paymentLinks[0]).toMatchObject({
      op: 'checkout',
      input: { tierId: 'tier-business', interval: 'year' },
    });
  });

  it('la moneda la decide el backend: se da la que devuelve, sin regla propia por país', async () => {
    const { run, gateway } = setup();
    // País España y moneda USD: no se corrige ni avisa, va la del backend (la que cobra Stripe).
    gateway.plans = gateway.plans.map((p) => ({ ...p, moneda: 'USD' }));

    const out = await run('enlace_contratar_plan', { plan: 'pro', periodo: 'mensual' });

    expect(out.data).toMatchObject({ moneda: 'USD', precio: '11 US$ al mes' });
    expect(gateway.plansQueries).toEqual([{ accountId: 'org-a', country: 'ES' }]);
  });

  it('la capacidad guía a Business mensual por defecto sin quitarle la elección al cliente', () => {
    const { reads } = setup();
    const description = reads.find((r) => r.name === 'enlace_contratar_plan')?.description;
    expect(description).toMatch(
      /Si no ha dicho plan, la recomendación es Business; si no ha dicho periodo, propón mensual; pregunta solo si duda/
    );
    expect(description).toMatch(/si pide Pro o anual, dale ese/);
  });

  it('Pro anual si lo pide: se respeta la elección', async () => {
    const { run, gateway } = setup();

    const out = await run('enlace_contratar_plan', { plan: 'pro', periodo: 'anual' });

    expect(out.data).toMatchObject({ plan: 'Pro', periodo: 'anual', precio: '110 € al año' });
    expect(gateway.paymentLinks[0]).toMatchObject({
      op: 'checkout',
      input: { tierId: 'tier-pro', interval: 'year' },
    });
  });

  it('sin país en el contexto: no crea el checkout; pide preguntar el país y con su respuesta lo crea en su moneda', async () => {
    const { run, gateway } = setup([admin], null);

    const out = await run('enlace_contratar_plan', { plan: 'business', periodo: 'mensual' });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Pregúntale en qué país/);
    expect(gateway.paymentLinks).toEqual([]);

    await run('enlace_contratar_plan', { plan: 'business', periodo: 'mensual', pais: 'MX' });
    expect(gateway.paymentLinks).toEqual([
      expect.objectContaining({
        op: 'checkout',
        input: expect.objectContaining({ country: 'MX' }) as unknown,
      }),
    ]);
  });

  it('sin periodo: pide preguntarlo y no crea nada', async () => {
    const { run, gateway } = setup();

    const out = await run('enlace_contratar_plan', { plan: 'pro' });

    // Sin periodo no se inventa uno: se pide al modelo que proponga mensual (y pregunte solo si duda).
    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        'si no lo ha dicho, propón mensual; pregunta solo si duda'
      ) as unknown,
    });
    expect(gateway.paymentLinks).toEqual([]);
  });

  it('organización que YA paga: devuelve el portal y NUNCA crea un checkout (serían dos suscripciones)', async () => {
    const { run, gateway } = setup();
    pagando(gateway);

    const out = await run('enlace_contratar_plan', { plan: 'business', periodo: 'mensual' });

    expect(out).toMatchObject({
      ok: true,
      data: { enlace: gateway.portalUrl, tipo: 'portal_suscripcion', planActual: 'Pro' },
    });
    expect(out.avisos?.[0]).toMatch(/serían dos cobros/);
    expect(gateway.paymentLinks).toEqual([
      {
        op: 'portal',
        accountId: 'org-a',
        returnUrl: 'https://dashboard.patroltech.online/license',
      },
    ]);
  });

  it('si no se sabe que ya paga y el backend rechaza el checkout (ALREADY_SUBSCRIBED): devuelve el portal', async () => {
    const { run, gateway } = setup();
    gateway.planUsage = { ...gateway.planUsage, plan: 'Pro', pagaSuscripcion: null };
    gateway.checkoutError = new PatrolTechApiError(409, '/api/payments/checkout-session', {
      success: false,
      message: 'Error',
      meta: { error: { code: 'ALREADY_SUBSCRIBED' } },
    });

    const out = await run('enlace_contratar_plan', { plan: 'business', periodo: 'mensual' });

    expect(out).toMatchObject({
      ok: true,
      data: { enlace: gateway.portalUrl, tipo: 'portal_suscripcion', planActual: 'Pro' },
    });
    expect(out.avisos?.[0]).toMatch(/serían dos cobros/);
    expect(gateway.paymentLinks.map((l) => l.op)).toEqual(['checkout', 'portal']);
  });

  it.each([
    ['Editor', { roleType: 'EDITOR', scope: 'organization' as const }, /este usuario es Editor/],
    [
      'Admin solo de una ubicación',
      { roleType: 'ADMIN', scope: 'location' as const },
      /Admin solo de una ubicación/,
    ],
  ])(
    '%s: no genera enlace y dice que lo hace un Admin de la organización',
    async (_caso, rol, motivo) => {
      const { run, gateway } = setup([{ ...admin, ...rol }]);

      const out = await run('enlace_contratar_plan', { plan: 'pro', periodo: 'mensual' });

      expect(out).toMatchObject({ ok: false, error: expect.stringMatching(motivo) as unknown });
      expect(out.error).toMatch(/Solo un Admin de toda la organización «Acme Seguridad»/);
      expect(gateway.paymentLinks).toEqual([]);
    }
  );

  it('Enterprise: sin enlace ni llamadas al backend; a medida y con llamada agendada', async () => {
    const { run, gateway } = setup();

    const out = await run('enlace_contratar_plan', { plan: 'enterprise' });

    expect(out).toMatchObject({ ok: true, data: { plan: 'Enterprise', aMedida: true } });
    expect(out.avisos?.[0]).toMatch(/escalar_a_humano con `cita`/);
    expect(out.avisos?.[0]).toMatch(/si Business le cubre/);
    expect(gateway.paymentLinks).toEqual([]);
    expect(gateway.calls).toEqual([]);
  });

  it('rechazo del backend (403): se traduce para el cliente', async () => {
    const { run, gateway } = setup();
    gateway.paymentLinkError = new PatrolTechApiError(403, '/api/payments/checkout-session', {
      code: 'INSUFFICIENT_ORGANIZATION_ROLE',
    });

    const out = await run('enlace_contratar_plan', { plan: 'pro', periodo: 'mensual' });

    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining('no tiene permiso') as unknown,
    });
  });

  it('un enlace que no es de Stripe no se da', async () => {
    const { run, gateway } = setup();
    gateway.checkoutUrl = 'https://evil.example/pay';

    const out = await run('enlace_contratar_plan', { plan: 'pro', periodo: 'mensual' });

    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining('no es de Stripe') as unknown,
    });
  });

  it('multi-org: usa el rol del usuario en la organización elegida', async () => {
    const otra: OrganizationRef = {
      orgId: 'org-b',
      name: 'Beta',
      roleType: 'VIEWER',
      scope: 'organization',
    };
    const { run, gateway, ctx } = setup([admin, otra]);
    const args = { plan: 'pro', periodo: 'mensual' };

    expect((await run('enlace_contratar_plan', args, conOrganizacion(ctx, 'Beta'))).ok).toBe(false);
    const out = await run('enlace_contratar_plan', args, conOrganizacion(ctx, 'Acme'));

    expect(out.ok).toBe(true);
    expect(gateway.paymentLinks.map((l) => l.accountId)).toEqual(['org-a']);
  });

  it('sin rol en la sesión: decide el backend', async () => {
    const { run, gateway } = setup([{ orgId: 'org-a', name: 'Acme Seguridad' }]);

    const out = await run('enlace_contratar_plan', { plan: 'pro', periodo: 'mensual' });

    expect(out.ok).toBe(true);
    expect(gateway.paymentLinks).toHaveLength(1);
  });
});

describe('enlace_gestionar_suscripcion', () => {
  it('organización que paga: enlace del portal con la vuelta a Licencia', async () => {
    const { run, gateway } = setup();
    pagando(gateway);

    const out = await run('enlace_gestionar_suscripcion');

    expect(out).toEqual({ ok: true, data: { enlace: gateway.portalUrl, planActual: 'Pro' } });
    expect(gateway.paymentLinks).toEqual([
      {
        op: 'portal',
        accountId: 'org-a',
        returnUrl: 'https://dashboard.patroltech.online/license',
      },
    ]);
  });

  it('organización que nunca ha pagado: el backend no abre el portal y se explica sin jerga', async () => {
    const { run, gateway } = setup();
    gateway.paymentLinkError = new PatrolTechApiError(400, '/api/payments/customer-portal', {
      code: 'PORTAL_SESSION_FAILED',
    });

    const out = await run('enlace_gestionar_suscripcion');

    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining('no tiene suscripción de pago (plan Free)') as unknown,
    });
  });

  it('no Admin: no genera el portal', async () => {
    const { run, gateway } = setup([{ ...admin, roleType: 'EDITOR' }]);
    pagando(gateway);

    const out = await run('enlace_gestionar_suscripcion');

    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining('Solo un Admin') as unknown,
    });
    expect(gateway.paymentLinks).toEqual([]);
  });

  it('la vuelta del portal es la `urls.license` del consumidor', async () => {
    const { gateway, ctx } = setup();
    pagando(gateway);
    const reads = readCapabilities({
      gateway,
      urls: { license: 'https://panel.staging.test/license' },
    });

    await reads.find((r) => r.name === 'enlace_gestionar_suscripcion')?.call(ctx, {});

    expect(gateway.paymentLinks).toEqual([
      { op: 'portal', accountId: 'org-a', returnUrl: 'https://panel.staging.test/license' },
    ]);
  });
});
