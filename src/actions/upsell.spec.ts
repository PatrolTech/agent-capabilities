import { describe, it, expect, beforeEach } from 'vitest';
import { buildCatalog } from '../catalog/buildCatalog.js';
import { FakePatrolTechGateway } from '../testing/FakePatrolTechGateway.js';
import { actionCatalog } from './index.js';
import type { ActionDefinition, ActionPrepareContext } from './types.js';

/**
 * Política de upsell en los errores de `preparar`: el bot (por defecto) explica
 * el límite con el plan y Licencia, con los textos de siempre; el MCP
 * (`upsell: false`) da solo los números, sin plan ni Licencia.
 */

const ORG = { orgId: 'org-1', name: 'Empresa Demo' };
const prepCtx: ActionPrepareContext = {
  org: ORG,
  organizations: [ORG],
  token: 'jwt',
  tz: 'Europe/Madrid',
  country: 'ES',
  language: 'es',
  user: { id: 'u-yo', name: 'Ana García' },
};
const PLAN_RE = /\b(free|pro|business|plan|licencia|mejorar)\b/i;

let pt: FakePatrolTechGateway;

beforeEach(() => {
  pt = new FakePatrolTechGateway();
  // En el límite de checkpoints (7 de 7, el fake por defecto) y de gestores.
  pt.planUsage = {
    ...pt.planUsage,
    uso: { ...pt.planUsage.uso!, gestores: { usados: 3, limite: 3 } },
  };
  pt.orgUsers = [
    ...pt.orgUsers,
    {
      id: 'u-luis',
      nombre: 'Luis Mora',
      email: 'luis@acme.test',
      roles: [{ id: 'r-luis', rol: 'VIEWER', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
    },
  ];
});

/** Los cuatro `preparar` que anticipan un límite, con lo que cada uno pide. */
const LIMITES: [string, Record<string, unknown>][] = [
  ['create_checkpoint', { nombre: 'Entrada', metodo: 'qr', ubicacion: 'Sede Central' }],
  ['archive_checkpoint', { checkpoint: 'garaje', archivar: false }],
  ['invite_user', { nombre: 'Eva', email: 'eva@acme.test', rol: 'EDITOR' }],
  ['change_user_role', { usuario: 'Luis', rol: 'EDITOR' }],
];

async function errorDe(
  catalog: ActionDefinition[],
  nombre: string,
  params: Record<string, unknown>
) {
  const r = await catalog.find((d) => d.nombre === nombre)!.preparar!(prepCtx, params);
  if (!('error' in r)) throw new Error(`${nombre}: preparar debía fallar`);
  return r.error;
}

describe('upsell: true (por defecto, el bot): los textos de siempre', () => {
  const LICENCIA = 'https://dashboard.patroltech.online/license';
  const ESPERADO: Record<string, string> = {
    create_checkpoint:
      'Ha llegado al límite de checkpoints de su plan Free (7 de 7). No lo propongas: ' +
      `explícale que puede mejorar el plan en Licencia (${LICENCIA}) o, si su plan lo permite, añadir el checkpoint extra desde el panel.`,
    archive_checkpoint:
      'Ha llegado al límite de checkpoints de su plan Free (7 de 7) y desarchivar cuenta como crear uno. ' +
      `No lo propongas: explícale que puede mejorar el plan en Licencia (${LICENCIA}), archivar otro antes o, si su plan lo permite, desarchivarlo desde el panel con el cargo extra.`,
    invite_user:
      'Ha llegado al límite de gestores (Editor o Admin) de su plan Free (3 de 3). No lo propongas así: ' +
      `ofrécele invitarla como VIEWER (solo ver), que no ocupa plaza, o mejorar el plan en Licencia (${LICENCIA}).`,
    change_user_role:
      'Ha llegado al límite de gestores (Editor o Admin) de su plan Free (3 de 3). No lo propongas así: ' +
      `puede seguir como VIEWER, quitar el rol de gestor a otra persona o mejorar el plan en Licencia (${LICENCIA}).`,
  };

  it.each(LIMITES)('%s: idéntico byte a byte, sin `upsell` y con `upsell: true`', async (n, p) => {
    expect(await errorDe(actionCatalog({ gateway: pt }), n, p)).toBe(ESPERADO[n]);
    expect(await errorDe(actionCatalog({ gateway: pt, upsell: true }), n, p)).toBe(ESPERADO[n]);
  });

  it.each(LIMITES)('%s: el catálogo del bot sigue con upsell', async (n, p) => {
    const { actions } = buildCatalog({ gateway: pt }, { channel: 'bot' });
    const catalog = actions.map((a) => a.action);
    if (!catalog.some((d) => d.nombre === n)) return; // solo las que ofrece el canal
    expect(await errorDe(catalog, n, p)).toBe(ESPERADO[n]);
  });
});

describe('upsell: false (MCP): el límite con sus números, sin plan ni Licencia', () => {
  it.each(LIMITES)('%s', async (n, p) => {
    const error = await errorDe(actionCatalog({ gateway: pt, upsell: false }), n, p);
    expect(error).not.toMatch(PLAN_RE);
    expect(error).not.toContain('/license');
    expect(error).toMatch(n.includes('user') ? /\(3 de 3\)/ : /\(7 de 7\)/);
    expect(error).toContain('No lo propongas');
  });

  it('buildCatalog(mcp) va sin upsell aunque las dependencias digan `upsell: true`', async () => {
    const { actions } = buildCatalog({ gateway: pt, upsell: true }, { channel: 'mcp' });
    const catalog = actions.map((a) => a.action);
    const ofrecidas = LIMITES.filter(([n]) => catalog.some((d) => d.nombre === n));
    // Invitar y subir de rol dan acceso: el MCP no las ofrece, solo el bot.
    expect(ofrecidas.map(([n]) => n)).toEqual(['create_checkpoint']);
    for (const [n, p] of ofrecidas) {
      expect(await errorDe(catalog, n, p)).not.toMatch(PLAN_RE);
    }
  });
});
