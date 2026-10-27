import { describe, it, expect } from 'vitest';
import { organizationParam, resolveOrganization } from './organization.js';
import type { OrganizationRef } from '../context.js';
import { readHarness } from '../testing/index.js';

const madrid: OrganizationRef = { orgId: 'org-m', name: 'Vigilancia Madrid' };
const barcelona: OrganizationRef = { orgId: 'org-bcn', name: 'Vigilancia Barcelona' };
const ajena: OrganizationRef = { orgId: 'org-ajena', name: 'Seguridad Ajena SL' };

describe('resolveOrganization — la organización se resuelve SIEMPRE antes de llamar a la capacidad', () => {
  it('multi-org con una organización que el usuario no tiene: error con sus organizaciones', () => {
    const out = resolveOrganization({ organizations: [madrid, barcelona] }, 'Seguridad Ajena SL');

    expect(out).toEqual({
      error: 'Organización no reconocida',
      opciones: ['Vigilancia Madrid', 'Vigilancia Barcelona'],
    });
  });

  it('multi-org con el parámetro vacío: error (no cae en la primera organización)', () => {
    expect(resolveOrganization({ organizations: [madrid, barcelona] })).toHaveProperty('error');
    expect(resolveOrganization({ organizations: [madrid, barcelona] }, '')).toHaveProperty('error');
  });

  it('multi-org con un nombre ambiguo: error y vuelven las opciones', () => {
    const out = resolveOrganization({ organizations: [madrid, barcelona] }, 'Vigilancia');

    expect(out).toMatchObject({
      error: expect.stringMatching(/^ambigua/) as unknown,
      opciones: ['Vigilancia Madrid', 'Vigilancia Barcelona'],
    });
  });

  it('multi-org resuelta: devuelve la organización elegida, con su rol', () => {
    const conRol = { ...barcelona, roleType: 'ADMIN', scope: 'organization' as const };

    expect(resolveOrganization({ organizations: [madrid, conRol] }, 'Vigilancia Barcelona')).toBe(
      conRol
    );
  });

  it('una sola organización: no hace falta nombrarla', () => {
    expect(resolveOrganization({ organizations: [madrid] })).toBe(madrid);
  });

  it('el parámetro de organización no acepta la cadena vacía', () => {
    expect(organizationParam.safeParse('').success).toBe(false);
    expect(organizationParam.safeParse('Vigilancia Madrid').success).toBe(true);
  });

  it('never resolves an organization outside ctx.organizations', () => {
    const ctx = { organizations: [madrid, barcelona] };

    // Ni por nombre, ni por id, ni por un índice fuera de la lista, ni por un trozo.
    for (const pedida of ['Seguridad Ajena SL', 'org-ajena', '3', 'Ajena', ajena.name]) {
      const out = resolveOrganization(ctx, pedida);
      expect(out).toHaveProperty('error');
      expect(JSON.stringify(out)).not.toContain('org-ajena');
    }
    // Con una sola organización, nombrar otra no la cambia: sigue siendo la suya.
    expect(resolveOrganization({ organizations: [madrid] }, 'Seguridad Ajena SL')).toBe(madrid);
    // Sin organizaciones no hay ninguna que resolver.
    expect(resolveOrganization({ organizations: [] }, 'Vigilancia Madrid')).toHaveProperty('error');
  });

  it('una capacidad con `org` fuera de `organizations` no llega al backend', async () => {
    const { gateway, run, ctx } = readHarness({ ctx: { organizations: [madrid] } });

    const out = await run('consultar_uso_plan', {}, { ...ctx, org: ajena });

    expect(out).toMatchObject({ ok: false, error: 'Organización no reconocida' });
    expect(gateway.calls).toEqual([]);
  });

  it('el rol y el ámbito salen de la entrada de la SESIÓN, no de la copia de `ctx.org`', async () => {
    const viewer: OrganizationRef = { ...madrid, roleType: 'VIEWER', scope: 'organization' };
    const { gateway, run, ctx } = readHarness({ ctx: { organizations: [viewer] } });
    gateway.planUsage = { ...gateway.planUsage, pagaSuscripcion: true };

    // El consumidor arma `ctx.org` con un rol que la sesión no le da.
    const out = await run(
      'enlace_gestionar_suscripcion',
      {},
      {
        ...ctx,
        org: { ...viewer, name: 'Nombre del consumidor', roleType: 'ADMIN' },
      }
    );

    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining('«Vigilancia Madrid»') as unknown,
    });
    expect(out.error).toContain('Solo un Admin');
    expect(gateway.paymentLinks).toEqual([]);
  });

  it('el argumento `organizacion` que llegue a la capacidad se ignora: manda `ctx.org`', async () => {
    const { gateway, run } = readHarness({ ctx: { organizations: [madrid, barcelona] } });

    const out = await run('consultar_uso_plan', { organizacion: 'Vigilancia Barcelona' });

    expect(out.ok).toBe(true);
    expect(gateway.calls).toEqual(['org-m']);
  });
});
