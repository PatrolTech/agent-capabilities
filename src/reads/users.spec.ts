import { describe, it, expect } from 'vitest';
import { PatrolTechApiError } from '../domain/backend-errors.js';
import {
  FakePatrolTechGateway,
  readHarness,
  runRead,
  capabilityContext,
} from '../testing/index.js';
import { readCapabilities } from './index.js';

describe('consultar_usuarios_y_roles', () => {
  it('usuarios con rol y ámbito (la ubicación por su nombre) y qué puede cambiar cada rol', async () => {
    const { run } = readHarness();

    const out = await run('consultar_usuarios_y_roles');

    expect(out.data?.usuarios).toEqual([
      { nombre: 'Marta Ruiz', email: 'marta@acme.test', roles: ['Admin de toda la organización'] },
      {
        nombre: 'Pedro Gil',
        email: 'pedro@acme.test',
        roles: ['Observador (Viewer) de la ubicación «Sucursal Norte»'],
      },
    ]);
    expect(out.data?.queHaceCadaRol).toMatchObject({
      editor: expect.stringContaining('crea y edita checkpoints, rutas, patrulleros') as unknown,
    });
  });

  it('a quien no es Admin (403), mensaje claro', async () => {
    const { run, gateway } = readHarness();
    gateway.orgUsersError = new PatrolTechApiError(403, '/api/organizations/users', {
      message: 'Insufficient permissions',
    });

    const out = await run('consultar_usuarios_y_roles');

    expect(out.ok).toBe(false);
    expect(out.error).toContain('Solo un Admin de la organización puede ver sus usuarios y roles');
  });

  it('con upsell (el bot) explica también lo de Licencia y facturas', async () => {
    const { run } = readHarness();

    const out = await run('consultar_usuarios_y_roles');

    expect(JSON.stringify(out.data?.queHaceCadaRol)).toMatch(/Licencia y facturas/);
  });

  it('sin upsell (MCP) lo que hace cada rol no habla de Licencia, plan, facturas ni pagos', async () => {
    const reads = readCapabilities({ gateway: new FakePatrolTechGateway(), upsell: false });

    const out = await runRead(reads, 'consultar_usuarios_y_roles', capabilityContext());

    expect(out.data?.queHaceCadaRol).toMatchObject({
      editor: expect.stringContaining('crea y edita checkpoints, rutas, patrulleros') as unknown,
    });
    expect(JSON.stringify(out.data?.queHaceCadaRol)).not.toMatch(
      /licencia|\bplan\b|factura|\bpagos?\b/i
    );
  });
});
