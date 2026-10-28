import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { internalParamNames } from '../actions/index.js';
import type { IncidentDetail } from '../gateway/index.js';
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

/**
 * Las claves en inglés que puede devolver una lectura `mcp` (ya traducidas o en inglés de origen).
 * Una clave nueva tiene que estar aquí o en el diccionario: así no se cuela una en español.
 */
const ENGLISH_OUTPUT_KEYS = new Set([
  'active',
  'activePatrollers',
  'address',
  'admin',
  'alert',
  'assignedTo',
  'atLeast',
  'author',
  'avgScansPerPatroller',
  'avgTimeBetweenScans',
  'bestCompletionRate',
  'category',
  'checkpoint',
  'checkpointName',
  'checkpoints',
  'checkpointsCreated',
  'closedAt',
  'completed',
  'completedCheckpoints',
  'completionRate',
  'createdAt',
  'date',
  'daysWithoutScan',
  'description',
  'done',
  'editor',
  'email',
  'end',
  'endTime',
  'entries',
  'entriesWithoutExit',
  'exits',
  'expired',
  'flagged',
  'fraudFlagged',
  'from',
  'generalLink',
  'guard',
  'guards',
  'guardsWithScans',
  'hasScans',
  'hidden',
  'history',
  'id',
  'inProgress',
  'inactive',
  'included',
  'incomplete',
  'insideNow',
  'invalid',
  'isActive',
  'lastScan',
  'lastScanAt',
  'latest',
  'limit',
  'link',
  'links',
  'location',
  'locationName',
  'locations',
  'managers',
  'messageToForward',
  'name',
  'nextStep',
  'noVisibleScans',
  'number',
  'open',
  'patrollerName',
  'patrollers',
  'pending',
  'pendingReview',
  'people',
  'photos',
  'position',
  'priority',
  'ranking',
  'reason',
  'reportedBy',
  'resolvedAt',
  'roles',
  'round',
  'rounds',
  'roundsCompleted',
  'route',
  'routeName',
  'routesCreated',
  'scanned',
  'schedules',
  'scope',
  'start',
  'startTime',
  'status',
  'summary',
  'suspicionReasons',
  'suspicious',
  'suspiciousScans',
  'time',
  'timestamp',
  'timezone',
  'title',
  'to',
  'topCheckpoints',
  'total',
  'totalCheckpoints',
  'totalScans',
  'type',
  'usage',
  'used',
  'users',
  'valid',
  'validation',
  'videos',
  'viewer',
  'what',
  'whatEachRoleDoes',
  'who',
  'windowDays',
  'withoutRecordedExit',
  'zone',
  // Del backend, en inglés de origen.
  'found',
  'incidentsOpen',
  'incidentsReported',
  'order',
  'patroller',
  'retentionCutoff',
  'scanTime',
  'scannedCount',
  'totalCount',
  'totalRounds',
]);

const incidentDetail = (estado: IncidentDetail['estado']): IncidentDetail => ({
  id: 'inc-1',
  oculta: false,
  titulo: 'Puerta del almacén forzada',
  descripcion: 'Apareció abierta',
  estado,
  prioridad: 'CRITICAL',
  categoria: 'Seguridad',
  subcategoria: null,
  reportadaPor: 'Juan Pérez',
  asignadaA: null,
  locationId: 'loc-central',
  creadaEn: '2026-07-29T09:00:00Z',
  resueltaEn: null,
  cerradaEn: null,
  checkpoints: ['Almacén'],
  timeline: [
    {
      tipo: 'COMMENT',
      autor: 'Juan Pérez',
      texto: 'Avisado',
      antes: null,
      despues: null,
      fecha: '2026-07-29T10:00:00Z',
      conAdjunto: false,
    },
  ],
  fotos: 0,
  videos: 0,
});

/** Las salidas de las lecturas `mcp` en sus casos con datos, como las ve el modelo. */
async function mcpOutputs(): Promise<{ id: string; data: unknown }[]> {
  const gateway = new FakePatrolTechGateway();
  gateway.incidentDetails['inc-1'] = incidentDetail('IN_PROGRESS');
  const entry = (id: string, tipo: 'ENTRY' | 'EXIT', fecha: string) => ({
    id,
    fecha,
    tipo,
    locationId: 'loc-central',
    zona: 'Portería',
    persona: 'Ana',
    identificadorPersona: null,
    visitante: null,
    documentoVisitante: null,
    empresaVisitante: null,
    destino: null,
    notas: null,
    oculto: false,
  });
  const now = Date.now();
  gateway.accessLogs = [entry('a1', 'ENTRY', new Date(now - 3_600_000).toISOString())];
  gateway.activeAccessEntries = [
    entry('a1', 'ENTRY', new Date(now - 3_600_000).toISOString()),
    entry('a2', 'ENTRY', new Date(now - 3 * 86_400_000).toISOString()),
  ];
  const { reads } = buildCatalog({ gateway }, { channel: 'mcp' });
  const calls: [string, Record<string, unknown>][] = [
    ...reads.map(({ meta }): [string, Record<string, unknown>] => [meta.id, {}]),
    ['incidents.get', { incidencia: 'almacén' }],
    ['patrollers.get_stats', { vigilante: 'Juan' }],
    ['patrollers.get_app_links', { vigilante: 'Juan Pérez' }],
    ['rounds.get_checkpoints', { ruta: 'Ruta Norte' }],
    ['rounds.get_round', { ruta: 'Ruta Sur' }],
    ['access.list_logs', { solo_dentro: true }],
  ];
  const outputs: { id: string; data: unknown }[] = [];
  for (const [id, args] of calls) {
    const read = reads.find(({ meta }) => meta.id === id)!.read;
    const result = await read.call(capabilityContext(), args);
    if (result.ok) outputs.push({ id, data: englishFields(result.data) });
  }
  return outputs;
}

describe('englishFields', () => {
  it('every field name of every mcp read is English (translated or English at the source)', async () => {
    const outputs = await mcpOutputs();
    // Cada lectura `mcp` aporta al menos una salida con datos.
    expect(new Set(outputs.map(({ id }) => id))).toEqual(
      new Set(mcp().reads.map(({ meta }) => meta.id))
    );
    for (const { id, data } of outputs) {
      for (const key of keysOf(data)) {
        expect(looksSpanish(key), `${id}.${key}`).toBe(false);
        expect(ENGLISH_OUTPUT_KEYS.has(key), `${id}.${key} is not a known English field`).toBe(
          true
        );
      }
    }
  });

  it('gives incident statuses and priorities the vocabulary of the English params', async () => {
    const outputs = await mcpOutputs();
    const list = outputs.find(({ id }) => id === 'incidents.list')!.data as Record<
      string,
      unknown
    >[];
    const detail = outputs.find(({ id }) => id === 'incidents.get')!.data;

    expect(list.map(({ status, priority }) => [status, priority])).toEqual([
      ['open', 'high'],
      ['in_progress', 'low'],
      ['closed', 'medium'],
    ]);
    expect(detail).toMatchObject({ status: 'in_progress', priority: 'critical' });
    // Los mismos valores que acepta el parámetro `status` de la lista.
    const { params } = mcp().reads.find(({ meta }) => meta.id === 'incidents.list')!.read;
    const schema = z.object(englishInputSchema('incidents.list', params));
    for (const { status } of list) expect(schema.safeParse({ status }).success).toBe(true);
    expect(englishFields({ estado: 'Descartado', prioridad: 'Baja' })).toEqual({
      status: 'dismissed',
      priority: 'low',
    });
  });

  it('only translates the values of those fields, never names written by users', () => {
    expect(
      englishFields({ nombre: 'Alta', titulo: 'Abierto', estado: 'completed', ruta: 'Media' })
    ).toEqual({ name: 'Alta', title: 'Abierto', status: 'completed', route: 'Media' });
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
