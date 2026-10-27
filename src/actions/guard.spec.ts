import { describe, it, expect, beforeEach } from 'vitest';
import type { OrganizationRef } from '../context.js';
import { FakePatrolTechGateway } from '../testing/FakePatrolTechGateway.js';
import { withOrganizationGuard } from './guard.js';
import { actionCatalog } from './index.js';
import { AccionRechazada } from './names.js';
import {
  roleAllows,
  type ActionContext,
  type ActionDefinition,
  type ActionPrepareContext,
} from './types.js';

/**
 * Anti-fuga en las escrituras: lo mismo que las lecturas. Una acción con `org`
 * fuera de las organizaciones de la sesión ni prepara ni ejecuta, y dentro usa la
 * entrada de la sesión (nombre, rol, ámbito), no la copia del consumidor.
 */

const ORG: OrganizationRef = {
  orgId: 'org-1',
  name: 'Empresa Demo',
  roleType: 'ADMIN',
  scope: 'organization',
};
const AJENA: OrganizationRef = { orgId: 'org-ajena', name: 'Seguridad Ajena SL' };

const prepCtx = (over: Partial<ActionPrepareContext> = {}): ActionPrepareContext => ({
  org: ORG,
  organizations: [ORG],
  token: 'jwt',
  tz: 'Europe/Madrid',
  country: 'ES',
  language: 'es',
  user: { id: 'u-yo', name: 'Ana García' },
  ...over,
});
const execCtx = (over: Partial<ActionContext> = {}): ActionContext => ({
  ...prepCtx(),
  idempotencyKey: null,
  ...over,
});

let pt: FakePatrolTechGateway;
let catalog: ActionDefinition[];
const action = (nombre: string): ActionDefinition => catalog.find((d) => d.nombre === nombre)!;
const editar = { ubicacion: 'Sede Central', ubicacion_id: 'loc-central', nombre: 'Oficinas' };

beforeEach(() => {
  pt = new FakePatrolTechGateway();
  catalog = actionCatalog({ gateway: pt });
});

describe('withOrganizationGuard en el catálogo de acciones', () => {
  it('preparar con `org` fuera de `organizations`: el error de las lecturas y ninguna llamada al backend', async () => {
    for (const d of catalog) {
      const r = await d.preparar!(prepCtx({ org: AJENA }), {});
      expect(r, d.nombre).toEqual({ error: 'Organización no reconocida' });
    }
    expect(pt.calls).toEqual([]);
    expect(pt.writes).toEqual([]);
  });

  it('ejecutar con `org` fuera de `organizations`: AccionRechazada y ningún cambio', async () => {
    for (const d of catalog) {
      const r = d.ejecutar(execCtx({ org: AJENA }), {});
      await expect(r, d.nombre).rejects.toBeInstanceOf(AccionRechazada);
      await expect(r, d.nombre).rejects.toThrow('Organización no reconocida');
    }
    expect(pt.calls).toEqual([]);
    expect(pt.writes).toEqual([]);
  });

  it('sin organizaciones en la sesión tampoco hay acción', async () => {
    const r = await action('edit_location').preparar!(prepCtx({ organizations: [] }), {
      ubicacion: 'Sede Central',
      nombre: 'Oficinas',
    });
    expect(r).toEqual({ error: 'Organización no reconocida' });
  });

  it('ejecutar usa la entrada de la sesión: el nombre que cita es el suyo, no el del consumidor', async () => {
    const r = await action('edit_location').ejecutar(
      execCtx({ org: { orgId: 'org-1', name: 'Nombre del consumidor', roleType: 'VIEWER' } }),
      editar
    );
    expect(r.texto).toBe('✅ Ubicación «Oficinas» de Empresa Demo actualizada.');
    expect(pt.writes).toEqual([
      { op: 'updateLocation', input: { id: 'loc-central', name: 'Oficinas' }, token: 'jwt' },
    ]);
  });

  it('preparar recibe la entrada de la sesión (rol y ámbito incluidos)', async () => {
    const vistos: OrganizationRef[] = [];
    const espia = withOrganizationGuard({
      ...action('edit_location'),
      preparar: (ctx, params) => {
        vistos.push(ctx.org);
        return Promise.resolve({ params });
      },
    });
    await espia.preparar!(
      prepCtx({ org: { orgId: 'org-1', name: 'Copia', roleType: 'VIEWER' } }),
      {}
    );
    expect(vistos).toEqual([ORG]);
  });

  it('una acción sin `preparar` propio sigue protegida y devuelve sus parámetros tal cual', async () => {
    const { preparar: _sinPreparar, ...resto } = action('edit_location');
    const guardada = withOrganizationGuard(resto);
    expect(await guardada.preparar!(prepCtx(), editar)).toEqual({ params: editar });
    expect(await guardada.preparar!(prepCtx({ org: AJENA }), editar)).toEqual({
      error: 'Organización no reconocida',
    });
  });
});

describe('roleAllows con OrganizationRef', () => {
  it('sin rol en la sesión cuenta como VIEWER', () => {
    const sinRol: OrganizationRef = { orgId: 'org-1', name: 'Empresa Demo' };
    expect(roleAllows(action('edit_location'), sinRol)).toBe(false);
    expect(roleAllows(action('edit_location'), { ...sinRol, roleType: 'editor' })).toBe(true);
  });
});
