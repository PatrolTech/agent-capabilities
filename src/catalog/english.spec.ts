import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { internalParamNames } from '../actions/index.js';
import { FakePatrolTechGateway } from '../testing/index.js';
import { capabilityContext } from '../testing/reads.js';
import { buildCatalog } from './buildCatalog.js';
import { argsFromEnglish, englishFields, englishInputSchema } from './english.js';

const mcp = () => buildCatalog({ gateway: new FakePatrolTechGateway() }, { channel: 'mcp' });

/** Los parámetros que ve el modelo de cada capacidad `mcp` (las acciones, sin los internos). */
function modelShapes(): { id: string; shape: z.ZodRawShape }[] {
  const { reads, actions } = mcp();
  return [
    ...reads.map(({ meta, read }) => ({ id: meta.id, shape: read.params })),
    ...actions.map(({ meta, action }) => {
      const internal = new Set(internalParamNames(action.params));
      return {
        id: meta.id,
        shape: Object.fromEntries(
          Object.entries(action.params).filter(([name]) => !internal.has(name))
        ),
      };
    }),
  ];
}

/** Todas las claves de un valor JSON, a cualquier profundidad. */
function keysOf(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, acc));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      acc.add(key);
      keysOf(v, acc);
    }
  }
  return acc;
}

/** Palabras de un nombre en español (los nombres en inglés no las llevan). */
const SPANISH_WORD =
  /^(ubicaci[oó]n|ubicaciones|nombre|vigilantes?|periodo|desde|hasta|rutas?|fecha|hora|estado|enlaces?|enlace|uso|usad[oa]s|incluidos|identificador|validaci[oó]n|mensaje|para|reenviar|solo|d[ií]as|incidencias?|comentario|asignar|tel[eé]fono|direcci[oó]n|descripci[oó]n|franjas|m[eé]todo|canal|activa|activar|operaci[oó]n|zona|tipo|sin|con|[uú]ltimo|escaneos?|m[ií]nimos|sospechosos|v[aá]lidos|dentro)$/i;

/** ¿Algún trozo del nombre (snake_case o camelCase) es una palabra en español? */
const looksSpanish = (name: string): boolean =>
  name.split(/_|(?=[A-Z])/).some((word) => SPANISH_WORD.test(word));

describe('englishInputSchema', () => {
  it('every param the mcp model sees has an English name and description', () => {
    const shapes = modelShapes();

    expect(shapes.length).toBeGreaterThan(20);
    for (const { id, shape } of shapes) {
      const english = englishInputSchema(id, shape);
      for (const [name, schema] of Object.entries(english)) {
        expect(looksSpanish(name), `${id}.${name}`).toBe(false);
        expect(name, `${id}.${name}`).toMatch(/^[a-zA-Z]+$/);
        expect((schema as z.ZodType).description, `${id}.${name}`).toMatch(/^[\x20-\x7E]+$/);
      }
    }
  });

  it('throws for a param without an English description', () => {
    expect(() => englishInputSchema('rounds.get_round', { nuevo: z.string() })).toThrow(
      'rounds.get_round.nuevo'
    );
  });

  it('translates enum values and keeps the checks of the original schema', () => {
    const { reads } = mcp();
    const read = reads.find(({ meta }) => meta.id === 'scans.list_recent')!.read;
    const schema = z.object(englishInputSchema('scans.list_recent', read.params));

    expect(schema.safeParse({ period: 'last_7_days' }).success).toBe(true);
    expect(schema.safeParse({ period: 'ultimos_7_dias' }).success).toBe(false);
    expect(schema.safeParse({ from: 'ayer' }).success).toBe(false);
    expect(schema.safeParse({ guard: '' }).success).toBe(false);
  });
});

describe('argsFromEnglish', () => {
  it('gives the capability its Spanish params and values, nested ones too', () => {
    const { actions } = mcp();
    const { params } = actions.find(({ meta }) => meta.id === 'routes.propose_create')!.action;

    const args = argsFromEnglish(params, {
      name: 'Ronda nocturna',
      checkpoints: ['Puerta'],
      strictOrder: true,
      timeWindows: [{ days: ['mon', 'sun'], from: '22:00', to: '06:00', repeatEveryMin: 60 }],
      organization: 'Acme',
    });

    expect(args).toEqual({
      nombre: 'Ronda nocturna',
      checkpoints: ['Puerta'],
      orden_estricto: true,
      franjas: [{ dias: ['lun', 'dom'], desde: '22:00', hasta: '06:00', repetir_cada_min: 60 }],
    });
  });

  it('a round trip through the English schema reaches the capability as the bot would send it', () => {
    const { reads } = mcp();
    const { params } = reads.find(({ meta }) => meta.id === 'access.list_logs')!.read;
    const parsed = z
      .object(englishInputSchema('access.list_logs', params))
      .parse({ period: 'yesterday', type: 'exit', insideOnly: false });

    expect(z.object(params).parse(argsFromEnglish(params, parsed))).toEqual({
      periodo: 'ayer',
      tipo: 'salida',
      solo_dentro: false,
    });
  });
});

describe('englishFields', () => {
  it('no mcp read returns a Spanish field name', async () => {
    const { reads } = mcp();
    const ctx = capabilityContext();

    for (const { meta, read } of reads) {
      const result = await read.call(ctx, meta.id === 'incidents.get' ? { incidencia: '1' } : {});
      for (const key of keysOf(englishFields(result.ok ? result.data : null))) {
        expect(looksSpanish(key), `${meta.id}.${key}`).toBe(false);
      }
    }
  });

  it('renames the keys at any depth and leaves values alone', () => {
    expect(
      englishFields({
        uso: { checkpoints: { usados: 3, incluidos: 5 } },
        enlaces: [{ vigilante: 'Ruta 1', enlace: 'https://x' }],
        fecha: new Date(0),
      })
    ).toEqual({
      usage: { checkpoints: { used: 3, included: 5 } },
      links: [{ guard: 'Ruta 1', link: 'https://x' }],
      date: new Date(0),
    });
  });
});
