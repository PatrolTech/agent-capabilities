import { describe, it, expect, beforeEach } from 'vitest';
import { FakePatrolTechGateway } from '../testing/FakePatrolTechGateway.js';
import { actionCatalog, actionTexts } from './index.js';
import type { ActionContext, ActionDefinition, ActionPrepareContext } from './types.js';

/** Los enlaces que citan las acciones salen de `urls` (una vez, en las dependencias). */

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
const execCtx: ActionContext = { ...prepCtx, idempotencyKey: null };
const URLS = { app: 'https://app.staging.test', dashboard: 'https://panel.staging.test' };

let pt: FakePatrolTechGateway;
let catalog: ActionDefinition[];
const action = (nombre: string): ActionDefinition => catalog.find((d) => d.nombre === nombre)!;

beforeEach(() => {
  pt = new FakePatrolTechGateway();
  catalog = actionCatalog({ gateway: pt, urls: URLS });
});

describe('acciones con `urls` inyectadas', () => {
  it('create_checkpoint en el límite remite a la Licencia de ESE panel', async () => {
    const r = await action('create_checkpoint').preparar!(prepCtx, {
      nombre: 'Entrada',
      metodo: 'qr',
      ubicacion: 'Sede Central',
    });
    expect(r).toEqual({ error: expect.stringContaining('https://panel.staging.test/license') });
    expect(JSON.stringify(r)).not.toContain('patroltech.online');
  });

  it('invite_user (gestor sin plaza) remite a la Licencia de ESE panel', async () => {
    const r = await action('invite_user').preparar!(prepCtx, {
      nombre: 'Luis',
      email: 'luis@acme.test',
      rol: 'EDITOR',
    });
    expect(r).toEqual({ error: expect.stringContaining('https://panel.staging.test/license') });
  });

  it('invite_user: el invitado entra en ESE panel', async () => {
    const r = await action('invite_user').ejecutar(execCtx, {
      nombre: 'Luis',
      email: 'luis@acme.test',
      rol: 'VIEWER',
    });
    expect(r.texto).toContain('Después entrará en https://panel.staging.test.');
    expect(r.texto).not.toContain('patroltech.online');
  });

  it('create_patroller: el enlace personal es de ESA app', async () => {
    const r = await action('create_patroller').ejecutar(execCtx, {
      nombre: 'Juan Pérez',
      identificador: 'ABCD2345',
    });
    expect(r.texto).toContain('https://app.staging.test/org-1/');
    expect(r.texto).not.toContain('app.patroltech.online');
  });
});

describe('actionTexts', () => {
  it('las políticas pendientes citan el panel recibido, en los tres idiomas', () => {
    const t = actionTexts(URLS);
    for (const idioma of ['es', 'en', 'fr'] as const) {
      expect(t[idioma].politicasPendientes).toContain('(https://panel.staging.test)');
    }
  });

  it('por defecto, el de producción (los textos de siempre)', () => {
    expect(actionTexts().es.politicasPendientes).toBe(
      'Antes de hacerlo tienes que aceptar las políticas vigentes en el panel (https://dashboard.patroltech.online). ' +
        'Cuando las aceptes, vuelve a pulsar *Confirmar*: lo tengo preparado.'
    );
  });
});
