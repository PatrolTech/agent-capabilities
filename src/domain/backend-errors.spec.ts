import { describe, it, expect } from 'vitest';
import {
  PatrolTechApiError,
  translateActionError,
  translateBackendError,
} from './backend-errors.js';
import { DEFAULT_URLS } from './urls.js';

// Cuerpos de error tal como los devuelve la API.
const apiError = (status: number, body: unknown) =>
  new PatrolTechApiError(status, '/api/checkpoints', body);
const enveloped = (message: string, meta: Record<string, unknown>) => ({
  success: false,
  message,
  data: null,
  meta,
});

describe('translateBackendError', () => {
  it('401 → sesión caducada (la única reintentable)', () => {
    const r = translateBackendError(
      apiError(401, enveloped('Token expired', { message: 'Token expired', code: 'TOKEN_EXPIRED' }))
    );
    expect(r.kind).toBe('session_expired');
    expect(r.mensajeCliente).toMatch(/No se ha hecho ningún cambio/);
  });

  it('403 → sin permiso', () => {
    const r = translateBackendError(
      apiError(403, enveloped('Insufficient permissions', { message: 'Insufficient permissions' }))
    );
    expect(r.kind).toBe('forbidden');
    expect(r.mensajeCliente).toMatch(/no tiene permiso/);
  });

  it('402 CHECKPOINT_LIMIT_REACHED → límite del plan con el mensaje del backend y enlace a Licencia', () => {
    const r = translateBackendError(
      apiError(402, {
        success: false,
        message: 'Has alcanzado el límite de checkpoints de tu plan (5).',
        data: null,
        code: 'CHECKPOINT_LIMIT_REACHED',
        error: 'Has alcanzado el límite de checkpoints de tu plan (5).',
        resource: 'checkpoints',
        limit: 5,
        currentUsage: 5,
        upsell: { plans: [] },
      })
    );
    expect(r.kind).toBe('plan_limit');
    expect(r.mensajeCliente).toContain('límite de checkpoints de tu plan (5)');
    expect(r.mensajeCliente).toContain('https://dashboard.patroltech.online/license');
  });

  it('409 EXTRA_CHECKPOINT_CONFIRMATION_REQUIRED → da el precio y deriva al panel, sin ofrecer confirmar el cobro', () => {
    const r = translateBackendError(
      apiError(409, {
        success: false,
        message: 'Este checkpoint supera los incluidos en tu plan y añadirá un cargo.',
        data: null,
        code: 'EXTRA_CHECKPOINT_CONFIRMATION_REQUIRED',
        error: 'Este checkpoint supera los incluidos en tu plan y añadirá un cargo.',
        limit: 20,
        currentUsage: 20,
        extraPrice: { currency: 'EUR', interval: 'month', amount: 300 },
      })
    );
    expect(r.kind).toBe('extra_checkpoint');
    expect(r.mensajeCliente).toMatch(/3,00\s€ al mes/);
    expect(r.mensajeCliente).toContain('desde el panel');
  });

  it('409 VERIFICATION_CODE_TAKEN → código en uso', () => {
    const r = translateBackendError(
      apiError(409, {
        success: false,
        message: 'Code taken',
        data: null,
        code: 'VERIFICATION_CODE_TAKEN',
        error: 'Code taken',
        conflictingCheckpointId: 'c1',
      })
    );
    expect(r.kind).toBe('code_taken');
  });

  describe('rutas: checkpoints que no se pueden añadir', () => {
    const archivado = () =>
      apiError(400, {
        success: false,
        message: 'Archived checkpoints cannot be added to a route',
        code: 'CHECKPOINT_ARCHIVED',
        data: { checkpointIds: ['c1'] },
      });
    const otroSitio = () =>
      apiError(400, {
        success: false,
        message: "Checkpoints must belong to the route's location",
        code: 'CHECKPOINT_NOT_IN_ROUTE_LOCATION',
        data: null,
      });

    it('400 CHECKPOINT_ARCHIVED → archivado, en su idioma y sin el mensaje en inglés del backend', () => {
      const es = translateBackendError(archivado());
      expect(es.kind).toBe('checkpoint_archived');
      expect(es.mensajeCliente).toBe(
        'Ese checkpoint está archivado y un checkpoint archivado no se puede usar en rutas. No se ha hecho ningún cambio. Si vuelve a estar en servicio, desarchívalo primero.'
      );
      expect(translateBackendError(archivado(), 'en').mensajeCliente).toContain(
        'archived checkpoint cannot be used in routes'
      );
      expect(translateBackendError(archivado(), 'fr').mensajeCliente).toContain(
        'checkpoint archivé ne peut pas être utilisé dans un parcours'
      );
      expect(es.mensajeCliente).not.toMatch(/cannot be added/);
    });

    it('400 ROUTE_HAS_NO_CHECKPOINTS → la ruta no tiene checkpoints, en su idioma y sin el mensaje en inglés', () => {
      const vacia = () =>
        apiError(400, {
          success: false,
          message: 'A route with no checkpoints cannot be activated: add checkpoints to it first',
          code: 'ROUTE_HAS_NO_CHECKPOINTS',
          data: null,
        });
      const es = translateBackendError(vacia());
      expect(es.kind).toBe('route_without_checkpoints');
      expect(es.mensajeCliente).toBe(
        'Esa ruta no tiene checkpoints y una ruta sin checkpoints no se puede activar. No se ha hecho ningún cambio. Añádele checkpoints primero y luego actívala.'
      );
      expect(translateBackendError(vacia(), 'en').mensajeCliente).toBe(
        "That route has no checkpoints, and a route without checkpoints can't be activated. No changes have been made. Add checkpoints to it first, then activate it."
      );
      expect(translateBackendError(vacia(), 'fr').mensajeCliente).toBe(
        "Ce parcours n'a pas de checkpoints, et un parcours sans checkpoints ne peut pas être activé. Aucune modification n'a été effectuée. Ajoutez-y d'abord des checkpoints, puis activez-le."
      );
    });

    it('400 CHECKPOINT_NOT_IN_ROUTE_LOCATION → de otra ubicación, en su idioma', () => {
      const es = translateBackendError(otroSitio());
      expect(es.kind).toBe('checkpoint_other_location');
      expect(es.mensajeCliente).toBe(
        'Ese checkpoint no es de la ubicación de la ruta: una ruta solo lleva checkpoints de su ubicación. No se ha hecho ningún cambio.'
      );
      expect(translateBackendError(otroSitio(), 'en').mensajeCliente).toContain(
        "isn't in the route's location"
      );
      expect(translateBackendError(otroSitio(), 'fr').mensajeCliente).toContain(
        "n'est pas sur le site du parcours"
      );
    });
  });

  it('400 VALIDATION_ERROR (envuelto por el envelope) → datos no válidos, SIN repetir el «Request validation failed» técnico', () => {
    const r = translateBackendError(
      apiError(
        400,
        enveloped('Error', {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: {} },
        })
      )
    );
    expect(r.kind).toBe('invalid_data');
    expect(r.mensajeCliente).toBe(
      'El panel no ha aceptado los datos. No se ha hecho ningún cambio.'
    );
  });

  it('422 → datos no válidos', () => {
    const r = translateBackendError(apiError(422, enveloped('El nombre es obligatorio', {})));
    expect(r).toMatchObject({
      kind: 'invalid_data',
      mensajeCliente: expect.stringContaining('El nombre es obligatorio'),
    });
  });

  it('451 → políticas pendientes de aceptar en el panel', () => {
    const r = translateBackendError(
      apiError(
        451,
        enveloped('Debes aceptar las políticas vigentes para continuar', { pending: [] })
      )
    );
    expect(r.kind).toBe('policies_pending');
    expect(r.mensajeCliente).toContain('https://dashboard.patroltech.online');
  });

  it('5xx y errores de red → no se ha hecho ningún cambio', () => {
    for (const err of [
      apiError(502, enveloped('Error', {})),
      new Error('network down'),
      'timeout',
    ]) {
      const r = translateBackendError(err);
      expect(r.kind).toBe('unavailable');
      expect(r.mensajeCliente).toMatch(/No se ha hecho ningún cambio/);
    }
  });

  describe('423 cuenta suspendida', () => {
    const suspended = (reason: string | undefined) =>
      apiError(423, {
        success: false,
        message: 'La cuenta de esta organización está suspendida',
        data: {
          code: 'ORGANIZATION_SUSPENDED',
          organizationId: 'o1',
          reason,
          scope: 'organization',
          effectiveAt: '2026-10-01T00:00:00Z',
        },
      });

    it('over_plan_limit → motivo y enlace a Licencia', () => {
      const r = translateBackendError(suspended('over_plan_limit'));
      expect(r.kind).toBe('account_suspended');
      expect(r.mensajeCliente).toContain(
        'está suspendida porque usa más puntos de control de los que incluye el plan gratuito.'
      );
      expect(r.mensajeCliente).toContain('https://dashboard.patroltech.online/license');
      expect(r.mensajeCliente).toContain(
        'escríbeme por aquí si prefieres seguir en el plan gratuito'
      );
      expect(r.mensajeCliente).toMatch(/No se ha hecho ningún cambio/);
    });

    it('unpaid → pago pendiente y enlace a Licencia', () => {
      const r = translateBackendError(suspended('unpaid'));
      expect(r.kind).toBe('account_suspended');
      expect(r.mensajeCliente).toContain('está suspendida por un pago pendiente.');
      expect(r.mensajeCliente).toContain(
        'pagando o actualizando el método de pago en Licencia: https://dashboard.patroltech.online/license'
      );
      expect(r.mensajeCliente).not.toContain('plan gratuito');
    });

    it('manual → sin motivo ni enlace: se ofrece revisarlo con el equipo', () => {
      const r = translateBackendError(suspended('manual'));
      expect(r.kind).toBe('account_suspended');
      expect(r.mensajeCliente).toContain('está suspendida. ');
      expect(r.mensajeCliente).toContain('Si crees que es un error');
      expect(r.mensajeCliente).not.toContain('/license');
    });

    it('en inglés, para cada motivo', () => {
      const a = translateBackendError(suspended('over_plan_limit'), 'en');
      expect(a.kind).toBe('account_suspended');
      expect(a.mensajeCliente).toContain(
        'account is suspended because it uses more checkpoints than the free plan includes.'
      );
      expect(a.mensajeCliente).toContain('/license');
      expect(translateBackendError(suspended('unpaid'), 'en').mensajeCliente).toContain(
        'because of a pending payment.'
      );
      const m = translateBackendError(suspended('manual'), 'en');
      expect(m.mensajeCliente).toContain('If you think this is a mistake');
      expect(m.mensajeCliente).not.toContain('/license');
    });

    it('motivo desconocido o ausente → texto genérico y cola de revisión manual', () => {
      for (const reason of ['otra_cosa', undefined]) {
        const r = translateBackendError(suspended(reason));
        expect(r.kind).toBe('account_suspended');
        expect(r.mensajeCliente).toContain('está suspendida. ');
        expect(r.mensajeCliente).toContain('Si crees que es un error');
        expect(r.mensajeCliente).not.toContain('/license');
      }
    });

    it('data.code no pisa el code de primer nivel en el 409 ni en el 402', () => {
      const data = { code: 'ORGANIZATION_SUSPENDED', reason: 'unpaid' };
      expect(
        translateBackendError(apiError(409, { code: 'VERIFICATION_CODE_TAKEN', data })).kind
      ).toBe('code_taken');
      expect(
        translateBackendError(
          apiError(402, { code: 'CHECKPOINT_LIMIT_REACHED', message: 'Límite.', data })
        ).kind
      ).toBe('plan_limit');
    });

    it('423 sin el código de suspensión → invalid_data como antes', () => {
      expect(translateBackendError(apiError(423, enveloped('Locked', {}))).kind).toBe(
        'invalid_data'
      );
    });
  });

  it('en inglés: mismos casos con el texto en inglés (el mensaje del 402 del backend, que va en español, no se usa)', () => {
    const r402 = translateBackendError(
      apiError(402, { message: 'Has alcanzado el límite (5).', code: 'CHECKPOINT_LIMIT_REACHED' }),
      'en'
    );
    expect(r402.kind).toBe('plan_limit');
    expect(r402.mensajeCliente).toContain("You've reached your plan's limit.");
    expect(r402.mensajeCliente).not.toContain('Has alcanzado');
    const r409 = translateBackendError(
      apiError(409, {
        code: 'EXTRA_CHECKPOINT_CONFIRMATION_REQUIRED',
        extraPrice: { currency: 'EUR', interval: 'year', amount: 3600 },
      }),
      'en'
    );
    expect(r409.mensajeCliente).toMatch(/€36\.00 per year/);
    expect(translateBackendError(apiError(403, {}), 'en').mensajeCliente).toMatch(
      /No changes have been made/
    );
    expect(translateBackendError(apiError(451, {}), 'en').mensajeCliente).toContain(
      'accept the current policies'
    );
    expect(translateBackendError(new Error('x'), 'en').kind).toBe('unavailable');
  });

  it('en francés: mismos casos con el texto en francés (el mensaje del 402 del backend, en español, tampoco se usa)', () => {
    const r402 = translateBackendError(
      apiError(402, { message: 'Has alcanzado el límite (5).', code: 'CHECKPOINT_LIMIT_REACHED' }),
      'fr'
    );
    expect(r402.mensajeCliente).toContain('Vous avez atteint la limite de votre forfait.');
    expect(r402.mensajeCliente).not.toContain('Has alcanzado');
    const r409 = translateBackendError(
      apiError(409, {
        code: 'EXTRA_CHECKPOINT_CONFIRMATION_REQUIRED',
        extraPrice: { currency: 'EUR', interval: 'month', amount: 300 },
      }),
      'fr'
    );
    expect(r409.mensajeCliente).toMatch(/3,00\s€ par mois/);
    expect(translateBackendError(apiError(403, {}), 'fr').mensajeCliente).toMatch(
      /Aucune modification n'a été effectuée/
    );
    expect(translateBackendError(apiError(451, {}), 'fr').mensajeCliente).toContain(
      'accepter les politiques en vigueur'
    );
    expect(translateBackendError(new Error('x'), 'fr').mensajeCliente).toMatch(/ne répond pas/);
  });

  describe('mensajes del backend que no son para el cliente (E2E staging)', () => {
    it('el mensaje repetido termina en punto antes de «No se ha hecho ningún cambio.»', () => {
      expect(
        translateBackendError(apiError(422, enveloped('El nombre es obligatorio', {})))
          .mensajeCliente
      ).toBe(
        'El panel no ha aceptado los datos: El nombre es obligatorio. No se ha hecho ningún cambio.'
      );
      expect(
        translateBackendError(apiError(422, enveloped('El nombre es obligatorio.', {})))
          .mensajeCliente
      ).not.toContain('..');
    });

    it('404 → «ya no existe» en su idioma, nunca «Location not found»', () => {
      const err = apiError(404, enveloped('Location not found', {}));
      expect(translateBackendError(err, 'es')).toEqual({
        kind: 'not_found',
        mensajeCliente:
          'Eso ya no existe en el panel: quizá se borró desde allí. No se ha hecho ningún cambio.',
      });
      expect(translateBackendError(err, 'en').mensajeCliente).toMatch(/no longer exists/);
      expect(translateBackendError(err, 'fr').mensajeCliente).toMatch(/n'existe plus/);
      for (const idioma of ['es', 'en', 'fr'] as const)
        expect(translateBackendError(err, idioma).mensajeCliente).not.toContain(
          'Location not found'
        );
    });

    it.each([
      'unique_user_role_scope already exists',
      'Database validation failed',
      'User already exists',
      'insert violates foreign key constraint',
    ])('«%s» no se repite: texto genérico', (m) => {
      expect(translateBackendError(apiError(400, enveloped(m, {})), 'es').mensajeCliente).toBe(
        'El panel no ha aceptado los datos. No se ha hecho ningún cambio.'
      );
    });

    it('en inglés y francés no se repite el mensaje del backend (va en español)', () => {
      const err = apiError(422, enveloped('El nombre es obligatorio', {}));
      expect(translateBackendError(err, 'en').mensajeCliente).toBe(
        "The dashboard didn't accept the data. No changes have been made."
      );
      expect(translateBackendError(err, 'fr').mensajeCliente).not.toContain('obligatorio');
    });
  });
});

// Nuevo respecto al bot: la URL del panel deja de ser una constante y se puede inyectar.
describe('translateBackendError · URL del panel inyectable', () => {
  const limite = () => apiError(402, { code: 'CHECKPOINT_LIMIT_REACHED', message: 'Límite.' });

  it('usa el panel de producción por defecto', () => {
    expect(DEFAULT_URLS.license).toBe('https://dashboard.patroltech.online/license');
    expect(translateBackendError(limite()).mensajeCliente).toContain(DEFAULT_URLS.license);
  });

  it.each(['es', 'en', 'fr'] as const)(
    'en %s usa la URL recibida en lugar de la de producción',
    (idioma) => {
      const r = translateBackendError(limite(), idioma, {
        urls: { dashboard: 'https://dashboard.staging.example.test' },
      });
      expect(r.mensajeCliente).toContain('https://dashboard.staging.example.test/license');
      expect(r.mensajeCliente).not.toContain('dashboard.patroltech.online');
    }
  );
});

// Política de upsell: el MCP nunca nombra planes ni invita a mejorarlos.
describe('translateBackendError · upsell', () => {
  const PLAN_RE = /\b(free|pro|business|plan|licencia|mejorar)\b/i;
  const LIMITE_CHECKPOINTS = {
    code: 'CHECKPOINT_LIMIT_REACHED',
    message: 'Has alcanzado el límite de checkpoints de tu plan (5).',
    resource: 'checkpoints',
    limit: 5,
    currentUsage: 5,
    upsell: { plans: [{ identifier: 'pro' }, { identifier: 'business' }] },
  };
  const LIMITE_GESTORES = {
    code: 'USER_LIMIT_REACHED',
    message: 'Has alcanzado el límite de usuarios gestores de tu plan (1).',
    resource: 'users',
    limit: 1,
    currentUsage: 1,
  };
  const suspendida = (reason: string) =>
    apiError(423, { data: { code: 'ORGANIZATION_SUSPENDED', reason } });
  const conPlan = [
    apiError(402, LIMITE_CHECKPOINTS),
    apiError(402, LIMITE_GESTORES),
    apiError(402, { code: 'LOCATION_LIMIT_REACHED', message: 'Límite de tu plan Free.' }),
    apiError(409, {
      code: 'EXTRA_CHECKPOINT_CONFIRMATION_REQUIRED',
      extraPrice: { currency: 'EUR', interval: 'month', amount: 300 },
    }),
    suspendida('over_plan_limit'),
    suspendida('unpaid'),
    suspendida('manual'),
  ];

  it.each(['es', 'en', 'fr'] as const)(
    'upsell: true (y sin opción) da los textos de siempre en %s',
    (idioma) => {
      for (const err of conPlan) {
        expect(translateBackendError(err, idioma, { upsell: true })).toEqual(
          translateBackendError(err, idioma)
        );
      }
      expect(translateBackendError(apiError(402, LIMITE_CHECKPOINTS), 'es').mensajeCliente).toBe(
        'Has alcanzado el límite de checkpoints de tu plan (5). No se ha hecho ningún cambio. ' +
          'Puedes ampliar el plan en Licencia: https://dashboard.patroltech.online/license'
      );
    }
  );

  it.each(['es', 'en', 'fr'] as const)(
    'upsell: false en %s: ni planes ni Licencia, y el mismo `kind`',
    (idioma) => {
      for (const err of conPlan) {
        const r = translateBackendError(err, idioma, { upsell: false });
        expect(r.kind).toBe(translateBackendError(err, idioma).kind);
        expect(r.mensajeCliente).not.toMatch(PLAN_RE);
        expect(r.mensajeCliente).not.toMatch(/forfait|gratuit|gratuito|upgrade|\/license/i);
      }
    }
  );

  it('upsell: false da el límite con sus números', () => {
    const neutro = (body: object, idioma: 'es' | 'en' | 'fr' = 'es') =>
      translateBackendError(apiError(402, body), idioma, { upsell: false }).mensajeCliente;

    expect(neutro(LIMITE_CHECKPOINTS)).toBe(
      'Se ha alcanzado el límite de checkpoints de la organización: 5 (5 en uso). No se ha hecho ningún cambio.'
    );
    expect(neutro(LIMITE_GESTORES)).toBe(
      'Se ha alcanzado el límite de gestores (Editor o Admin) de la organización: 1 (1 en uso). ' +
        'No se ha hecho ningún cambio. Puedes invitarla como Viewer (solo ver), que no ocupa plaza de gestor.'
    );
    expect(neutro(LIMITE_CHECKPOINTS, 'en')).toContain(
      'The organization has reached its checkpoints limit: 5 (5 in use).'
    );
    expect(neutro(LIMITE_CHECKPOINTS, 'fr')).toContain(
      "L'organisation a atteint sa limite de checkpoints : 5 (5 utilisés)."
    );
    // Sin números en el cuerpo: un límite genérico (el mensaje del backend nombra el plan).
    expect(neutro({ code: 'LOCATION_LIMIT_REACHED', message: 'Límite de tu plan Free.' })).toBe(
      'Se ha alcanzado un límite de uso de la organización. No se ha hecho ningún cambio.'
    );
  });

  it('upsell: false en la suspensión remite al panel, sin plan', () => {
    const r = translateBackendError(suspendida('over_plan_limit'), 'es', { upsell: false });
    expect(r.mensajeCliente).toBe(
      'La cuenta de esa organización está suspendida porque usa más puntos de control de los incluidos. ' +
        'No se ha hecho ningún cambio. Un administrador puede reactivarla desde el panel: https://dashboard.patroltech.online.'
    );
  });
});

describe('translateBackendError en una lectura (`operation: read`)', () => {
  const SIN_CAMBIOS = /No se ha hecho ningún cambio|No changes have been made|Aucune modification/;

  it.each([
    ['503', apiError(503, {})],
    ['403', apiError(403, {})],
    ['404', apiError(404, {})],
    ['timeout', new Error('The operation was aborted due to timeout')],
  ])('%s: no dice que no se haya cambiado nada (una lectura nunca cambia nada)', (_caso, err) => {
    for (const idioma of ['es', 'en', 'fr'] as const) {
      const lectura = translateBackendError(err, idioma, { upsell: false, operation: 'read' });
      expect(lectura.mensajeCliente).not.toMatch(SIN_CAMBIOS);
      expect(lectura.mensajeCliente).not.toMatch(/ {2}|^ | $/);
      expect(translateBackendError(err, idioma, { upsell: false }).mensajeCliente).toMatch(
        SIN_CAMBIOS
      );
    }
  });

  it('el resto del mensaje es el mismo que el de una acción', () => {
    const err = apiError(503, {});
    expect(translateBackendError(err, 'en', { operation: 'read' })).toEqual({
      kind: 'unavailable',
      mensajeCliente:
        "I couldn't complete it because the dashboard isn't responding right now. Please try again in a few minutes.",
    });
  });
});

describe('translateActionError', () => {
  const PLAN_RE = /\b(free|pro|business|plan|licencia|mejorar)\b/i;
  const limite = apiError(402, {
    code: 'CHECKPOINT_LIMIT_REACHED',
    message: 'Has alcanzado el límite de checkpoints de tu plan (5).',
    resource: 'checkpoints',
    limit: 5,
    currentUsage: 5,
  });

  it('es translateBackendError sin upsell, en el idioma pedido', () => {
    for (const idioma of ['es', 'en', 'fr'] as const) {
      expect(translateActionError(limite, idioma, DEFAULT_URLS)).toEqual(
        translateBackendError(limite, idioma, { urls: DEFAULT_URLS, upsell: false })
      );
    }
    expect(translateActionError(limite, 'en', DEFAULT_URLS).mensajeCliente).not.toMatch(PLAN_RE);
  });

  it('un fallo que no es del backend sale como no disponible', () => {
    expect(translateActionError(new Error('boom'), 'fr', DEFAULT_URLS).kind).toBe('unavailable');
  });
});
