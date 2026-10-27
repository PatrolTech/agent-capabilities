import { describe, it, expect, vi, type Mock } from 'vitest';
import type { Logger } from '../ports/Logger.js';
import { PatrolTechApiError } from './backend-errors.js';
import { ok, fail, safeExecute, type ToolResult } from './tool-result.js';

/** Logger espía: sustituye al `console.log` que el bot espiaba (el logger ahora se inyecta). */
const spyLogger = (): Logger & { error: Mock<Logger['error']> } => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn<Logger['error']>(),
});

describe('ToolResult', () => {
  it('ok envuelve los datos sin marcas cuando no hay avisos', () => {
    expect(ok([1, 2])).toEqual({ ok: true, data: [1, 2] });
  });

  it('ok propaga truncado y avisos solo cuando los hay', () => {
    expect(ok('x', { truncado: true, avisos: ['hay más datos'] })).toEqual({
      ok: true,
      data: 'x',
      truncado: true,
      avisos: ['hay más datos'],
    });
    expect(ok('x', { truncado: false, avisos: [] })).toEqual({ ok: true, data: 'x' });
  });

  it('fail devuelve el error y, si las hay, las opciones', () => {
    expect(fail('Organización no reconocida', ['A', 'B'])).toEqual({
      ok: false,
      error: 'Organización no reconocida',
      opciones: ['A', 'B'],
    });
    expect(fail('boom')).toEqual({ ok: false, error: 'boom' });
  });
});

/** El texto genérico del bot cuando el fallo no es un rechazo del backend. */
const NO_RESPONDE =
  'No he podido completarlo porque el panel no responde ahora mismo. No se ha hecho ningún cambio. Inténtalo de nuevo en unos minutos.';

describe('safeExecute', () => {
  it('devuelve el resultado tal cual si no lanza', async () => {
    const out = await safeExecute('consultar_x', () => Promise.resolve(ok(42)), {
      logger: spyLogger(),
    });
    expect(out).toEqual({ ok: true, data: 42 });
  });

  it('convierte un throw en { ok:false, error } en vez de tumbar el turno; el detalle va al logger', async () => {
    const logger = spyLogger();
    const err = new Error('PatrolTech API error 500 en /api/scans');
    const out = await safeExecute('consultar_x', () => Promise.reject(err), { logger });
    expect(out.ok).toBe(false);
    const failed = out as Extract<ToolResult<never>, { ok: false }>;
    expect(failed.error).toBe(NO_RESPONDE);
    expect(logger.error).toHaveBeenCalledWith(
      'tool.execute_failed',
      expect.objectContaining({ tool: 'consultar_x', kind: 'unavailable', err })
    );
  });

  it.each([
    ['unpaid', 'está suspendida por un pago pendiente'],
    ['over_plan_limit', 'porque usa más puntos de control de los que incluye el plan gratuito'],
    ['manual', 'Si crees que es un error'],
  ])(
    'un 423 de cuenta suspendida (%s) llega al modelo con el texto explicado al cliente',
    async (reason, texto) => {
      const out = await safeExecute(
        'consultar_x',
        () =>
          Promise.reject(
            new PatrolTechApiError(423, '/api/scans', {
              data: { code: 'ORGANIZATION_SUSPENDED', reason },
            })
          ),
        { logger: spyLogger() }
      );
      expect(out).toMatchObject({ ok: false, error: expect.stringContaining(texto) });
    }
  );

  it.each([
    [401, 'Tu sesión con el panel ha caducado'],
    [403, 'Tu usuario no tiene permiso'],
    [402, 'Límite.'],
    [404, 'Eso ya no existe en el panel'],
    [451, 'aceptar las políticas vigentes'],
    [422, 'El panel no ha aceptado los datos'],
    [500, 'el panel no responde'],
  ])('un %i llega traducido, nunca con el mensaje interno del error', async (status, texto) => {
    const logger = spyLogger();
    const err = new PatrolTechApiError(status, '/api/checkpoints/cp-1', {
      code: 'CHECKPOINT_LIMIT_REACHED',
      message: 'Límite.',
    });
    const out = await safeExecute('consultar_x', () => Promise.reject(err), { logger });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining(texto) });
    expect(JSON.stringify(out)).not.toContain('/api/checkpoints');
    expect(JSON.stringify(out)).not.toContain('PatrolTech API error');
    expect(logger.error).toHaveBeenCalledWith(
      'tool.execute_failed',
      expect.objectContaining({ status, path: '/api/checkpoints/cp-1', err })
    );
  });

  it('respeta la política de textos: sin upsell, el 402 no nombra el plan', async () => {
    const err = new PatrolTechApiError(402, '/api/checkpoints', {
      code: 'CHECKPOINT_LIMIT_REACHED',
      message: 'Has alcanzado el límite de checkpoints de tu plan (5).',
      resource: 'checkpoints',
      limit: 5,
      currentUsage: 5,
    });
    const out = await safeExecute('consultar_x', () => Promise.reject(err), { upsell: false });
    expect(out).toEqual({
      ok: false,
      error:
        'Se ha alcanzado el límite de checkpoints de la organización: 5 (5 en uso). No se ha hecho ningún cambio.',
    });
  });

  it('un error de red o de programación da el texto genérico (y no su mensaje)', async () => {
    for (const err of [
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      new Error('fetch failed'),
    ]) {
      const out = await safeExecute('consultar_x', () => Promise.reject(err));
      expect(out).toEqual({ ok: false, error: NO_RESPONDE });
    }
  });

  it('también captura valores lanzados que no son Error', async () => {
    const out = await safeExecute(
      'consultar_x',
      // El test cubre a propósito un valor rechazado que no es un Error.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      () => Promise.reject('texto suelto'),
      { logger: spyLogger() }
    );
    expect(out).toEqual({ ok: false, error: NO_RESPONDE });
  });

  // Nuevo respecto al bot (el logger ya no es global): sin logger inyectado no hay salida ni fallo.
  it('sin logger inyectado no falla: el error se descarta en silencio con el logger nulo', async () => {
    const out = await safeExecute('consultar_x', () => Promise.reject(new Error('boom')));
    expect(out).toEqual({ ok: false, error: NO_RESPONDE });
  });

  it.each([
    ['en', "I couldn't complete it because the dashboard isn't responding right now."],
    ['fr', "Je n'ai pas pu le faire car le tableau de bord ne répond pas pour le moment."],
  ] as const)('traduce los errores al idioma del cliente (%s)', async (language, texto) => {
    const out = await safeExecute('consultar_x', () => Promise.reject(new Error('boom')), {
      language,
    });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining(texto) });
  });
});
