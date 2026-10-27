import { describe, it, expect } from 'vitest';
import type { ZodType } from 'zod';
import { actionCatalog, internalParamNames } from '../actions/index.js';
import { readCapabilities } from '../reads/index.js';
import { FakePatrolTechGateway } from '../testing/index.js';
import { buildCatalog } from './buildCatalog.js';
import { ACTION_ENTRIES, READ_ENTRIES } from './entries.js';

const deps = () => ({ gateway: new FakePatrolTechGateway(), offerFiles: true });

const BOT_ONLY_READS = ['enlace_contratar_plan', 'enlace_gestionar_suscripcion'];
// Lecturas por vigilante: en los dos canales.
const PER_GUARD_READS = [
  'consultar_ranking_vigilantes',
  'consultar_stats_vigilante',
  'consultar_escaneos_por_vigilante',
];
const DESTRUCTIVE_ACTIONS = [
  'delete_time_window',
  'delete_location',
  'archive_checkpoint',
  'edit_checkpoint_antifraud',
  'change_user_role',
  'remove_user_access',
  'move_checkpoint',
];
// Dar acceso (invitar a un usuario, dar de alta a un vigilante) lo veta el backend a
// cualquier agente MCP (AGENT_CANNOT_GRANT_ACCESS): solo lo propone el bot.
const ACCESS_GRANTING_ACTIONS = ['invite_user', 'create_patroller'];
const BOT_ONLY_ACTIONS = [...DESTRUCTIVE_ACTIONS, ...ACCESS_GRANTING_ACTIONS];
// Operaciones del SDK con las que se da acceso o se crean credenciales: ninguna
// capacidad del canal mcp puede llamarlas.
const ACCESS_GRANTING_OPERATIONS = [
  'createOrganizationUser',
  'createPatroller',
  'unarchivePatroller',
  'updateUserRole',
  'deleteUserRole',
];

/** Un nombre de herramienta del bot (`consultar_incidencias`, `enviar_excel_*`, `proponer_*`, `enlace_*`). */
const BOT_TOOL_NAME = /\b(consultar|enviar|proponer|enlace)_[a-z_]+/;

/** Las descripciones de un parámetro zod y de todo lo que lleva dentro (opcional, lista, objeto, unión). */
function descriptionsOf(schema: unknown): string[] {
  const s = schema as ZodType & {
    def: {
      innerType?: unknown;
      element?: unknown;
      valueType?: unknown;
      in?: unknown;
      out?: unknown;
      options?: unknown[];
      items?: unknown[];
      shape?: Record<string, unknown>;
    };
  };
  const { innerType, element, valueType, in: input, out, options, items, shape } = s.def;
  return [
    ...(s.description ? [s.description] : []),
    ...[
      innerType,
      element,
      valueType,
      input,
      out,
      ...(options ?? []),
      ...(items ?? []),
      ...Object.values(shape ?? {}),
    ]
      .filter((inner) => inner !== undefined)
      .flatMap(descriptionsOf),
  ];
}

describe('buildCatalog', () => {
  it('every read and action has exactly one meta entry', () => {
    const d = deps();
    const readNames = readCapabilities(d).map((r) => r.name);
    const actionNames = actionCatalog(d).map((a) => a.nombre);

    expect(READ_ENTRIES.map((m) => m.capability).sort()).toEqual([...readNames].sort());
    expect(ACTION_ENTRIES.map((m) => m.capability).sort()).toEqual([...actionNames].sort());
    expect(readNames).toHaveLength(25);
    expect(actionNames).toHaveLength(19);
  });

  it('the bot catalog offers everything', () => {
    const { reads, actions } = buildCatalog(deps(), { channel: 'bot' });

    expect(reads).toHaveLength(25);
    expect(actions).toHaveLength(19);
  });

  it('only the alert preference is user-level (a new one must be reviewed: the MCP acts on it with any of the user’s organizations, enough only for the VIEWER role)', () => {
    const userScoped = [...READ_ENTRIES, ...ACTION_ENTRIES]
      .filter((m) => m.scope === 'user')
      .map((m) => m.id);

    expect(userScoped).toEqual(['alerts.propose_set_preference']);
  });

  it('mcp catalog offers the per-guard reads and excludes billing, destructive and access-granting actions', () => {
    const { reads, actions } = buildCatalog(deps(), { channel: 'mcp' });
    const readNames = reads.map((r) => r.read.name);
    const actionNames = actions.map((a) => a.action.nombre);

    for (const name of PER_GUARD_READS) expect(readNames).toContain(name);
    for (const name of BOT_ONLY_READS) expect(readNames).not.toContain(name);
    for (const name of BOT_ONLY_ACTIONS) expect(actionNames).not.toContain(name);
    expect(reads).toHaveLength(25 - BOT_ONLY_READS.length);
    expect(actions).toHaveLength(19 - BOT_ONLY_ACTIONS.length);
  });

  it('mcp catalog has no capability that grants access to anyone', () => {
    const { reads, actions } = buildCatalog(deps(), { channel: 'mcp' });
    const mcpMetas = [...reads, ...actions].map(({ meta }) => meta);

    for (const name of ACCESS_GRANTING_ACTIONS) {
      const meta = ACTION_ENTRIES.find((m) => m.capability === name);
      expect(meta?.channels, name).toEqual(['bot']);
      expect(meta?.visibility, name).toBe('internal');
      expect(mcpMetas.map((m) => m.capability)).not.toContain(name);
    }
    for (const meta of mcpMetas) {
      for (const op of ACCESS_GRANTING_OPERATIONS) {
        expect(meta.operationIds, `${meta.id} -> ${op}`).not.toContain(op);
      }
    }
  });

  it('mcp catalog has no destructive entry', () => {
    const { reads, actions } = buildCatalog(deps(), { channel: 'mcp' });

    expect([...reads, ...actions].filter(({ meta }) => meta.destructive)).toEqual([]);
  });

  it('returns each read and action next to its own meta', () => {
    const { reads, actions } = buildCatalog(deps(), { channel: 'mcp' });

    for (const { meta, read } of reads) {
      expect(meta.kind).toBe('read');
      expect(meta.readOnly).toBe(true);
      expect(meta.capability).toBe(read.name);
    }
    for (const { meta, action } of actions) {
      expect(meta.kind).toBe('action');
      expect(meta.readOnly).toBe(false);
      expect(meta.capability).toBe(action.nombre);
    }
  });

  it('without offerFiles the three file reads are not offered', () => {
    const { reads } = buildCatalog({ gateway: new FakePatrolTechGateway() }, { channel: 'bot' });

    expect(reads).toHaveLength(22);
    expect(reads.map((r) => r.read.name)).not.toContain('enviar_qr_checkpoint');
  });

  it('mcp entries are public and bot-only entries are internal', () => {
    for (const meta of [...READ_ENTRIES, ...ACTION_ENTRIES]) {
      expect(meta.visibility).toBe(meta.channels.includes('mcp') ? 'public' : 'internal');
    }
  });

  it('mcp titles and summaries never mention plan names', () => {
    const { reads, actions } = buildCatalog(deps(), { channel: 'mcp' });

    for (const { meta } of [...reads, ...actions]) {
      const texts = [meta.title.es, meta.title.en, meta.summary.es, meta.summary.en];
      for (const text of texts) expect(text, meta.id).not.toMatch(/\b(free|pro|business|plan)\b/i);
    }
  });

  it('mcp titles and summaries are channel-neutral: no bot flow, chat channel or confirmation wording', () => {
    const { reads, actions } = buildCatalog(deps(), { channel: 'mcp' });

    for (const { meta } of [...reads, ...actions]) {
      const texts = [meta.title.es, meta.title.en, meta.summary.es, meta.summary.en];
      for (const text of texts) {
        expect(text, meta.id).not.toMatch(/confirmaci|confirmation|whatsapp|telegram|\bbot\b/i);
      }
    }
  });

  it('the params the system fills in are described as internal, without naming a channel', () => {
    const { actions } = buildCatalog(deps(), { channel: 'mcp' });
    const descriptionOf = (schema: unknown): string => (schema as ZodType).description ?? '';
    const internos = actions.flatMap(({ action }) =>
      Object.entries(action.params).filter(([, schema]) => /^interno/i.test(descriptionOf(schema)))
    );

    expect(internos.length).toBeGreaterThan(0);
    for (const [name, schema] of internos) {
      expect(descriptionOf(schema), name).toMatch(/no lo (rellenes|indiques)/i);
      expect(descriptionOf(schema), name).not.toMatch(/bot|whatsapp|telegram|chat/i);
    }
  });

  it('every param description the mcp model sees is free of bot, chat, plan and licence wording', () => {
    const { reads, actions } = buildCatalog(
      { gateway: new FakePatrolTechGateway(), offerFiles: false },
      { channel: 'mcp' }
    );
    const shapes = [
      ...reads.map(({ meta, read }) => ({ id: meta.id, params: read.params })),
      ...actions.map(({ meta, action }) => ({ id: meta.id, params: action.params })),
    ];

    const described = shapes.flatMap(({ id, params }) =>
      Object.entries(params).flatMap(([name, schema]) =>
        descriptionsOf(schema).map((text) => ({ where: `${id}.${name}`, text }))
      )
    );

    expect(described.length).toBeGreaterThan(30);
    for (const { where, text } of described) {
      expect(text, where).not.toMatch(/\bbot\b|\bchat\b|telegram|\bplan\b|licencia/i);
      // Los nombres de herramienta del bot no existen en otros canales: el modelo intentaría llamarlas.
      expect(text, where).not.toMatch(BOT_TOOL_NAME);
    }
  });

  it('every mcp read says in English what it returns, with the same neutral wording', () => {
    const { reads } = buildCatalog(deps(), { channel: 'mcp' });

    expect(reads.length).toBeGreaterThan(15);
    for (const { meta } of reads) {
      const returns = meta.returns?.en ?? '';
      expect(returns, meta.id).toMatch(/^Returns /);
      expect(returns, meta.id).not.toMatch(
        /\bplan\b|licen|\bbot\b|whatsapp|telegram|\bchat\b|confirmation/i
      );
      expect(returns, meta.id).not.toMatch(BOT_TOOL_NAME);
    }
  });

  it('internalParamNames lists exactly the params described as internal', () => {
    const { actions } = buildCatalog(deps(), { channel: 'mcp' });
    const byName = new Map(actions.map(({ action }) => [action.nombre, action]));

    expect(internalParamNames(byName.get('edit_location')!.params)).toEqual([
      'ubicacion_id',
      'direccion_actual',
    ]);
    expect(internalParamNames(byName.get('set_alert_preference')!.params)).toEqual([]);
    for (const { action } of actions) {
      const internal = internalParamNames(action.params);
      for (const [name, schema] of Object.entries(action.params)) {
        const described = /^interno/i.test((schema as ZodType).description ?? '');
        expect(internal.includes(name), `${action.nombre}.${name}`).toBe(described);
      }
    }
  });

  it('the bot-only descriptions keep the bot wording (the MCP never shows them)', () => {
    const { reads, actions } = buildCatalog(deps(), { channel: 'bot' });
    const readDescription = (name: string) =>
      reads.find(({ read }) => read.name === name)?.read.description ?? '';
    const actionDescription = (name: string) =>
      actions.find(({ action }) => action.nombre === name)?.action.descripcion ?? '';

    expect(readDescription('consultar_accesos')).toContain(
      'Nunca escribas en el chat el documento de un visitante.'
    );
    expect(readDescription('consultar_checkpoints_sin_revisar')).toContain(
      'anteriores a la retención de datos del plan'
    );
    for (const name of ['add_time_window', 'create_route']) {
      expect(actionDescription(name), name).toContain('el bot las convierte a UTC');
    }
  });

  it('titles are short and summaries start with the usage cue', () => {
    for (const meta of [...READ_ENTRIES, ...ACTION_ENTRIES]) {
      expect(meta.title.es.length, meta.id).toBeLessThanOrEqual(60);
      expect(meta.title.en.length, meta.id).toBeLessThanOrEqual(60);
      expect(meta.summary.es, meta.id).toMatch(/^Úsala cuando /);
      expect(meta.summary.en, meta.id).toMatch(/^Use when /);
    }
  });

  it('ids are unique and match /^[a-z]+(\\.[a-z_]+)+$/', () => {
    const ids = [...READ_ENTRIES, ...ACTION_ENTRIES].map((m) => m.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
  });

  it('marks the sensitive actions as destructive and nothing else read-only', () => {
    const destructive = ACTION_ENTRIES.filter((m) => m.destructive).map((m) => m.capability);

    expect(destructive.sort()).toEqual([...DESTRUCTIVE_ACTIONS].sort());
    expect(READ_ENTRIES.some((m) => m.destructive)).toBe(false);
  });

  it('every entry is owned and verified with a YYYY-MM-DD date', () => {
    for (const meta of [...READ_ENTRIES, ...ACTION_ENTRIES]) {
      expect(meta.owner).toBe('producto');
      expect(meta.verifiedAt).toBe('2026-10-22');
      expect(meta.status).toBe('ga');
    }
  });
});
