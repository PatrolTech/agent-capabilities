import { describe, it, expect, beforeEach } from 'vitest';
import { actionCatalog } from './index.js';
import type { ActionContext, ActionDefinition, ActionPrepareContext } from './types.js';
import { AccionRechazada, BOT_ACTIONS } from './names.js';
import type { FixedTextLanguage } from '../domain/language.js';
import { FakePatrolTechGateway } from '../testing/FakePatrolTechGateway.js';

/**
 * Cambiar el rol y quitar el acceso a una persona que ya está en el panel
 * La persona y su rol salen SOLO de `listOrgUsers` de la organización.
 */

const ORG = { orgId: 'org-1', name: 'Empresa Demo' };
const YO = { id: 'u-yo', name: 'Ana García' };
const prepCtx = (idioma: FixedTextLanguage = 'es'): ActionPrepareContext => ({
  org: ORG,
  organizations: [ORG],
  token: 'jwt',
  country: 'ES',
  language: idioma,
  tz: 'Europe/Madrid',
  user: YO,
});
const execCtx = (idioma: FixedTextLanguage = 'es'): ActionContext => ({
  ...prepCtx(idioma),
  user: YO,
  idempotencyKey: null,
});

let pt: FakePatrolTechGateway;
let catalog: ActionDefinition[];
const action = (nombre: string): ActionDefinition => catalog.find((d) => d.nombre === nombre)!;

async function prepared(
  nombre: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const r = await action(nombre).preparar!(prepCtx(), params);
  if ('error' in r) throw new Error(`preparar falló: ${r.error}`);
  return r.params;
}
async function prepError(nombre: string, params: Record<string, unknown>): Promise<string> {
  const r = await action(nombre).preparar!(prepCtx(), params);
  if (!('error' in r)) throw new Error(`preparar debía fallar: ${JSON.stringify(r.params)}`);
  return r.error;
}

beforeEach(() => {
  pt = new FakePatrolTechGateway();
  pt.locations = [
    { id: 'loc-central', name: 'Sede Central', address: 'Calle Mayor 1' },
    { id: 'loc-norte', name: 'Sucursal Norte', address: 'Av. del Norte 5' },
  ];
  pt.orgUsers = [
    {
      id: 'u-yo',
      nombre: 'Ana García',
      email: 'ana@acme.test',
      roles: [{ id: 'r-yo', rol: 'ADMIN', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
    },
    {
      id: 'u-marta',
      nombre: 'Marta Ruiz',
      email: 'marta@acme.test',
      roles: [{ id: 'r-marta', rol: 'ADMIN', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
    },
    {
      id: 'u-pedro',
      nombre: 'Pedro Gil',
      email: 'Pedro.Gil@Acme.test',
      roles: [
        { id: 'r-pedro-org', rol: 'VIEWER', ambito: 'ORGANIZATION', scopeId: 'org-1' },
        { id: 'r-pedro-norte', rol: 'EDITOR', ambito: 'LOCATION', scopeId: 'loc-norte' },
      ],
    },
    {
      id: 'u-luis',
      nombre: 'Luis Mora',
      email: 'luis@acme.test',
      roles: [{ id: 'r-luis', rol: 'VIEWER', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
    },
  ];
  pt.planUsage = {
    ...pt.planUsage,
    uso: { ...pt.planUsage.uso!, gestores: { usados: 2, limite: 3 } },
  };
  catalog = actionCatalog({ gateway: pt });
});

describe('catálogo: roles de usuarios', () => {
  it('las dos acciones exigen ADMIN de organización y tienen su flag en BOT_ACTIONS', () => {
    const roles = catalog.filter((d) =>
      ['change_user_role', 'remove_user_access'].includes(d.nombre)
    );
    expect(roles.map((d) => [d.nombre, d.tool, d.rolMinimo, d.rolDeOrganizacion ?? false])).toEqual(
      [
        ['change_user_role', 'proponer_cambiar_rol_usuario', 'ADMIN', true],
        ['remove_user_access', 'proponer_quitar_acceso_usuario', 'ADMIN', true],
      ]
    );
    expect(BOT_ACTIONS).toEqual(expect.arrayContaining(['change_user_role', 'remove_user_access']));
  });
});

describe('change_user_role: preparar', () => {
  it('resuelve la persona por email (sin mayúsculas) y el rol de la lista, nunca ids del modelo', async () => {
    const p = await prepared('change_user_role', {
      usuario: ' LUIS@acme.test ',
      rol: 'EDITOR',
      rol_id: 'r-de-otra-org',
      usuario_id: 'u-otro',
    });
    expect(p).toMatchObject({
      usuario: 'Luis Mora',
      email: 'luis@acme.test',
      usuario_id: 'u-luis',
      rol_id: 'r-luis',
      rol_actual: 'VIEWER',
      rol: 'EDITOR',
    });
    expect(p.ubicacion).toBeUndefined();
  });

  it('también por nombre (sin tildes ni mayúsculas)', async () => {
    expect(await prepared('change_user_role', { usuario: 'marta', rol: 'EDITOR' })).toMatchObject({
      rol_id: 'r-marta',
      rol_actual: 'ADMIN',
    });
  });

  it('alguien que no está en la organización → no lo propone y sugiere invitarla', async () => {
    const error = await prepError('change_user_role', { usuario: 'Rosa', rol: 'EDITOR' });
    expect(error).toContain('No encuentro a «Rosa»');
    expect(error).toContain('proponer_invitar_usuario');
    expect(
      await prepError('change_user_role', { usuario: 'rosa@acme.test', rol: 'EDITOR' })
    ).toContain('rosa@acme.test');
  });

  it('dos personas que casan con el nombre → pregunta cuál, con su email', async () => {
    pt.orgUsers.push({
      id: 'u-luis2',
      nombre: 'Luis Pérez',
      email: 'lperez@acme.test',
      roles: [{ id: 'r-l2', rol: 'VIEWER', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
    });
    const error = await prepError('change_user_role', { usuario: 'luis', rol: 'EDITOR' });
    expect(error).toContain('Luis Mora (luis@acme.test)');
    expect(error).toContain('Luis Pérez (lperez@acme.test)');
  });

  it('con varios accesos pregunta cuál (numerados); se elige por número, por ubicación o «organización»', async () => {
    const error = await prepError('change_user_role', { usuario: 'Pedro', rol: 'ADMIN' });
    expect(error).toContain('1. Viewer (solo ver) de toda la organización');
    expect(error).toContain('2. Editor de la ubicación «Sucursal Norte»');
    expect(
      await prepared('change_user_role', { usuario: 'Pedro', rol: 'ADMIN', acceso: '2' })
    ).toMatchObject({ rol_id: 'r-pedro-norte', ubicacion: 'Sucursal Norte', rol_actual: 'EDITOR' });
    expect(
      await prepared('change_user_role', { usuario: 'Pedro', rol: 'ADMIN', acceso: 'norte' })
    ).toMatchObject({ rol_id: 'r-pedro-norte' });
    expect(
      await prepared('change_user_role', {
        usuario: 'Pedro',
        rol: 'EDITOR',
        acceso: 'toda la organización',
      })
    ).toMatchObject({ rol_id: 'r-pedro-org' });
    expect(
      await prepError('change_user_role', { usuario: 'Pedro', rol: 'ADMIN', acceso: 'Marte' })
    ).toContain('1. Viewer');
  });

  it('nunca el rol propio', async () => {
    const error = await prepError('change_user_role', { usuario: 'ana@acme.test', rol: 'EDITOR' });
    expect(error).toContain('tu propio rol');
  });

  it('el mismo rol que ya tiene → nada que cambiar', async () => {
    expect(await prepError('change_user_role', { usuario: 'Luis', rol: 'VIEWER' })).toContain(
      'ya es'
    );
  });

  it('no deja la organización sin ningún Admin de organización', async () => {
    // Un admin global (equipo de PatrolTech) no está en la lista: Marta es la única Admin.
    pt.orgUsers = pt.orgUsers.filter((u) => u.id !== 'u-yo');
    const error = await prepError('change_user_role', { usuario: 'Marta', rol: 'EDITOR' });
    expect(error).toContain('único Admin');
    // Un Admin de UBICACIÓN no cuenta como Admin de la organización.
    pt.orgUsers.push({
      id: 'u-x',
      nombre: 'Xavi',
      email: 'x@acme.test',
      roles: [{ id: 'r-x', rol: 'ADMIN', ambito: 'LOCATION', scopeId: 'loc-norte' }],
    });
    expect(await prepError('change_user_role', { usuario: 'Marta', rol: 'VIEWER' })).toContain(
      'único Admin'
    );
  });

  it('subir un VIEWER a EDITOR o ADMIN comprueba las plazas de gestor; entre gestores no', async () => {
    pt.planUsage = {
      ...pt.planUsage,
      uso: { ...pt.planUsage.uso!, gestores: { usados: 3, limite: 3 } },
    };
    const error = await prepError('change_user_role', { usuario: 'Luis', rol: 'EDITOR' });
    expect(error).toContain('límite de gestores');
    expect(error).toContain('3 de 3');
    expect(await prepared('change_user_role', { usuario: 'Marta', rol: 'EDITOR' })).toMatchObject({
      rol: 'EDITOR',
    });
    expect(
      await prepared('change_user_role', { usuario: 'Pedro', acceso: '2', rol: 'VIEWER' })
    ).toMatchObject({ rol: 'VIEWER' });
  });
});

describe('change_user_role: ejecutar y resumen', () => {
  const params = {
    usuario: 'Luis Mora',
    email: 'luis@acme.test',
    usuario_id: 'u-luis',
    rol_id: 'r-luis',
    rol_actual: 'VIEWER',
    rol: 'EDITOR',
  };

  it('PUT con el id del rol resuelto y el rol nuevo', async () => {
    const r = await action('change_user_role').ejecutar(execCtx(), params);
    expect(pt.writes).toEqual([
      { op: 'updateUserRole', input: { userRoleId: 'r-luis', roleType: 'EDITOR' }, token: 'jwt' },
    ]);
    expect(r.texto).toContain('✅');
    expect(r.texto).toContain('Luis Mora');
    expect((await action('change_user_role').ejecutar(execCtx('en'), params)).texto).toContain(
      'now'
    );
  });

  it('vuelve a comprobar al confirmar: si ya no queda otro Admin de organización, no lo hace', async () => {
    pt.orgUsers = pt.orgUsers.filter((u) => u.id !== 'u-yo');
    const r = action('change_user_role').ejecutar(execCtx(), {
      ...params,
      usuario: 'Marta Ruiz',
      usuario_id: 'u-marta',
      rol_id: 'r-marta',
      rol_actual: 'ADMIN',
    });
    await expect(r).rejects.toBeInstanceOf(AccionRechazada);
    await expect(r).rejects.toThrow('No se ha hecho ningún cambio');
    expect(pt.writes).toEqual([]);
  });

  it('nunca el propio rol, aunque llegue así a ejecutar', async () => {
    await expect(
      action('change_user_role').ejecutar(execCtx('fr'), {
        ...params,
        usuario_id: 'u-yo',
        rol_id: 'r-yo',
      })
    ).rejects.toThrow('Aucune modification');
    expect(pt.writes).toEqual([]);
  });

  it('resumen es/en/fr con el rol de antes y el nuevo, y el ámbito', () => {
    const d = action('change_user_role');
    expect(
      d.resumen(
        { ...params, ubicacion: 'Sucursal Norte' },
        { idioma: 'es', organizacion: 'Empresa Demo' }
      )
    ).toBe(
      'Cambiar el rol de Luis Mora (luis@acme.test) en Empresa Demo: Viewer (solo ver) → Editor (acceso a la ubicación «Sucursal Norte»).'
    );
    expect(d.resumen(params, { idioma: 'en', organizacion: 'Empresa Demo' })).toBe(
      'Change the role of Luis Mora (luis@acme.test) in Empresa Demo: Viewer (view only) → Editor (access to the whole organization).'
    );
    expect(d.resumen(params, { idioma: 'fr', organizacion: 'Empresa Demo' })).toBe(
      "Changer le rôle de Luis Mora (luis@acme.test) dans Empresa Demo : Viewer (lecture seule) → Editor (accès à toute l'organisation)."
    );
  });
});

describe('remove_user_access', () => {
  it('preparar: resuelve persona y acceso; marca si era el único', async () => {
    expect(
      await prepared('remove_user_access', { usuario: 'Luis', rol_id: 'r-otro' })
    ).toMatchObject({ rol_id: 'r-luis', usuario_id: 'u-luis', unico: true });
    expect(
      await prepared('remove_user_access', { usuario: 'pedro.gil@acme.test', acceso: 'norte' })
    ).toMatchObject({
      rol_id: 'r-pedro-norte',
      email: 'Pedro.Gil@Acme.test',
      ubicacion: 'Sucursal Norte',
      unico: false,
    });
  });

  it('preparar: nunca a uno mismo ni al último Admin de organización', async () => {
    expect(await prepError('remove_user_access', { usuario: 'Ana' })).toContain('tu propio');
    pt.orgUsers = pt.orgUsers.filter((u) => u.id !== 'u-yo');
    expect(await prepError('remove_user_access', { usuario: 'Marta' })).toContain('único Admin');
  });

  it('ejecutar: DELETE del rol resuelto; re-comprueba las protecciones', async () => {
    const p = {
      usuario: 'Luis Mora',
      email: 'luis@acme.test',
      usuario_id: 'u-luis',
      rol_id: 'r-luis',
      rol_actual: 'VIEWER',
      unico: true,
    };
    const r = await action('remove_user_access').ejecutar(execCtx(), p);
    expect(pt.writes).toEqual([
      { op: 'deleteUserRole', input: { userRoleId: 'r-luis' }, token: 'jwt' },
    ]);
    expect(r.texto).toContain('✅');

    pt.writes.length = 0;
    await expect(
      action('remove_user_access').ejecutar(execCtx(), { ...p, usuario_id: 'u-yo', rol_id: 'r-yo' })
    ).rejects.toThrow('No se ha hecho ningún cambio');
    expect(pt.writes).toEqual([]);
  });

  it('resumen es/en/fr: dice si pierde todo el acceso y que se puede volver a invitar', () => {
    const d = action('remove_user_access');
    const p = { usuario: 'Luis Mora', email: 'luis@acme.test', rol_actual: 'VIEWER', unico: true };
    const es = d.resumen(p, { idioma: 'es', organizacion: 'Empresa Demo' });
    expect(es).toContain(
      'Quitar a Luis Mora (luis@acme.test) el acceso como Viewer (solo ver) de toda la organización en Empresa Demo'
    );
    expect(es).toContain('dejará de poder entrar');
    expect(es).toContain('volver a invitar');
    expect(
      d.resumen(
        { ...p, unico: false, ubicacion: 'Sucursal Norte' },
        { idioma: 'es', organizacion: 'Empresa Demo' }
      )
    ).toContain('Conserva sus otros accesos');
    expect(d.resumen(p, { idioma: 'en', organizacion: 'Empresa Demo' })).toContain(
      'invite them again'
    );
    expect(d.resumen(p, { idioma: 'fr', organizacion: 'Empresa Demo' })).toContain(
      'inviter à nouveau'
    );
  });
});

describe('invite_user: quien ya tiene acceso', () => {
  it('sugiere proponer_cambiar_rol_usuario en vez de mandar al panel', async () => {
    const error = await prepError('invite_user', {
      nombre: 'Luis',
      email: 'luis@acme.test',
      rol: 'EDITOR',
    });
    expect(error).toContain('ya tiene acceso');
    expect(error).toContain('proponer_cambiar_rol_usuario');
  });
});

// El colector del lote (máximo por confirmación, propuestas repetidas) es del motor de cada
// consumidor; aquí se prueba lo que pone la acción: la sesión en `preparar` y que dos formas
// de nombrar lo mismo preparan los MISMOS parámetros (la identidad con la que el motor descarta la repetida).
describe('lote: la sesión llega a preparar', () => {
  it('el usuario de la sesión no puede proponerse a sí mismo', async () => {
    const error = await prepError('change_user_role', { usuario: 'Ana', rol: 'VIEWER' });
    expect(error).toContain('tu propio rol');
  });

  it('la misma propuesta dos veces en el turno: prepara los mismos parámetros (el motor la rechaza como repetida)', async () => {
    const primera = await prepared('remove_user_access', { usuario: 'Pedro', acceso: '2' });
    // Dicha de otra forma, pero el mismo acceso de la misma persona.
    expect(
      await prepared('remove_user_access', { usuario: 'pedro.gil@acme.test', acceso: '2' })
    ).toEqual(primera);
    const otra = await prepared('remove_user_access', { usuario: 'Pedro', acceso: '1' });
    expect(otra).not.toEqual(primera);
    // Por nombre de ubicación en vez de por número: es uno de los dos ya propuestos.
    expect(await prepared('remove_user_access', { usuario: 'Pedro', acceso: 'norte' })).toEqual(
      primera
    );
  });
});
