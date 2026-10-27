import { describe, it, expect, beforeEach } from 'vitest';
import { actionCatalog } from './index.js';
import type { ActionContext, ActionDefinition, ActionPrepareContext } from './types.js';
import { BOT_ACTIONS } from './names.js';
import { PatrolTechApiError, translateBackendError } from '../domain/backend-errors.js';
import type { FixedTextLanguage } from '../domain/language.js';
import { FakePatrolTechGateway } from '../testing/FakePatrolTechGateway.js';

const ORG = { orgId: 'org-1', name: 'Empresa Demo' };
const prepCtx = (idioma: FixedTextLanguage = 'es'): ActionPrepareContext => ({
  org: ORG,
  organizations: [ORG],
  token: 'jwt',
  country: 'ES',
  language: idioma,
  tz: 'Europe/Madrid',
  user: { id: 'u-yo', name: 'Ana García' },
});
const execCtx = (idioma: FixedTextLanguage = 'es'): ActionContext => ({
  ...prepCtx(idioma),
  user: { id: 'u-yo', name: 'Ana García' },
  idempotencyKey: null,
});
const es = { idioma: 'es' as const, organizacion: 'Empresa Demo' };
const en = { idioma: 'en' as const, organizacion: 'Empresa Demo' };
const fr = { idioma: 'fr' as const, organizacion: 'Empresa Demo' };

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
  if (!('error' in r)) throw new Error('preparar debía fallar');
  return r.error;
}

beforeEach(() => {
  pt = new FakePatrolTechGateway();
  pt.locations = [
    { id: 'loc-central', name: 'Sede Central', address: 'Calle Mayor 1' },
    { id: 'loc-norte', name: 'Sucursal Norte', address: 'Av. del Norte 5' },
  ];
  pt.routes = [
    { id: 'r-norte', name: 'Ruta Norte', isActive: true, locationId: 'loc-central' },
    { id: 'r-sur', name: 'Ruta Sur', isActive: false, locationId: 'loc-norte' },
  ];
  pt.planUsage = {
    ...pt.planUsage,
    uso: { ...pt.planUsage.uso!, gestores: { usados: 1, limite: 3 } },
  };
  catalog = actionCatalog({ gateway: pt });
});

describe('catálogo: ubicaciones e invitaciones', () => {
  it('las tres acciones, con su flag en BOT_ACTIONS; borrar e invitar exigen ADMIN de organización', () => {
    expect(
      catalog
        .filter((d) => ['edit_location', 'delete_location', 'invite_user'].includes(d.nombre))
        .map((d) => [d.nombre, d.tool, d.rolMinimo, d.rolDeOrganizacion ?? false])
    ).toEqual([
      ['edit_location', 'proponer_editar_ubicacion', 'EDITOR', false],
      ['delete_location', 'proponer_borrar_ubicacion', 'ADMIN', true],
      ['invite_user', 'proponer_invitar_usuario', 'ADMIN', true],
    ]);
    expect(BOT_ACTIONS).toEqual(
      expect.arrayContaining(['edit_location', 'delete_location', 'invite_user'])
    );
  });
});

describe('edit_location', () => {
  it('preparar: resuelve la ubicación de la organización por nombre (nunca un id del modelo) y guarda la dirección actual', async () => {
    const p = await prepared('edit_location', {
      ubicacion: 'norte',
      direccion: 'Calle Nueva 7',
      ubicacion_id: 'loc-de-otra-org',
    });
    expect(p).toMatchObject({
      ubicacion: 'Sucursal Norte',
      ubicacion_id: 'loc-norte',
      direccion: 'Calle Nueva 7',
      direccion_actual: 'Av. del Norte 5',
    });
    expect(p.nombre).toBeUndefined();
  });

  it('preparar: con una sola ubicación no hace falta decirla', async () => {
    pt.locations = [pt.locations[0]];
    expect(await prepared('edit_location', { nombre: 'Oficinas' })).toMatchObject({
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
    });
  });

  it('preparar: exige que cambie algo (lo que es igual que ahora no cuenta)', async () => {
    expect(await prepError('edit_location', { ubicacion: 'Sede Central' })).toContain(
      'Falta qué cambiar'
    );
    expect(
      await prepError('edit_location', {
        ubicacion: 'Sede Central',
        nombre: 'Sede Central',
        direccion: 'Calle Mayor 1',
      })
    ).toContain('ya');
    // Lo que no cambia se quita: solo viaja lo nuevo.
    const p = await prepared('edit_location', {
      ubicacion: 'Sede Central',
      nombre: 'Sede Central',
      direccion: 'Calle Mayor 2',
    });
    expect(p.nombre).toBeUndefined();
    expect(p.direccion).toBe('Calle Mayor 2');
  });

  it('preparar: varias ubicaciones sin decir cuál, o una que no existe → pregunta con las opciones', async () => {
    expect(await prepError('edit_location', { nombre: 'X' })).toContain(
      '«Sede Central», «Sucursal Norte»'
    );
    expect(await prepError('edit_location', { ubicacion: 'Marte', nombre: 'X' })).toContain(
      'No encuentro la ubicación «Marte»'
    );
  });

  it('ejecutar: PUT SOLO con nombre y/o dirección (whitelist), nunca la dirección vacía', async () => {
    await action('edit_location').ejecutar(execCtx(), {
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
      nombre: 'Oficinas',
    });
    const r = await action('edit_location').ejecutar(execCtx('en'), {
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
      direccion: 'Calle Mayor 2',
      direccion_actual: 'Calle Mayor 1',
    });
    expect(pt.writes).toEqual([
      { op: 'updateLocation', input: { id: 'loc-central', name: 'Oficinas' }, token: 'jwt' },
      {
        op: 'updateLocation',
        input: { id: 'loc-central', address: 'Calle Mayor 2' },
        token: 'jwt',
      },
    ]);
    expect(r.texto).toBe('✅ Location «Sede Central» of Empresa Demo updated.');
  });

  it('resumen es/en/fr con lo que cambia y la dirección de antes', () => {
    const p = {
      ubicacion: 'Sede Central',
      nombre: 'Oficinas',
      direccion: 'Calle Mayor 2',
      direccion_actual: 'Calle Mayor 1',
    };
    const d = action('edit_location');
    expect(d.resumen(p, es)).toBe(
      'Cambiar la ubicación «Sede Central» de Empresa Demo: nombre → «Oficinas»; dirección → «Calle Mayor 2» (antes «Calle Mayor 1»).'
    );
    expect(d.resumen(p, en)).toBe(
      'Change the location «Sede Central» of Empresa Demo: name → «Oficinas»; address → «Calle Mayor 2» (was «Calle Mayor 1»).'
    );
    expect(d.resumen(p, fr)).toBe(
      'Modifier le site «Sede Central» de Empresa Demo : nom → «Oficinas»; adresse → «Calle Mayor 2» (avant «Calle Mayor 1»).'
    );
  });
});

describe('delete_location', () => {
  it('preparar: resuelve por nombre y cuenta sus checkpoints (activos y archivados) y rutas', async () => {
    const p = await prepared('delete_location', {
      ubicacion: 'sede',
      ubicacion_id: 'loc-de-otra-org',
    });
    expect(p).toMatchObject({
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
      checkpoints: 3,
      rutas: 1,
    });
  });

  it('preparar: se niega a borrar la ÚNICA ubicación de la organización', async () => {
    pt.locations = [pt.locations[0]];
    expect(await prepError('delete_location', { ubicacion: 'Sede Central' })).toContain(
      'única ubicación'
    );
  });

  it('preparar: una ubicación que no existe → pregunta', async () => {
    expect(await prepError('delete_location', { ubicacion: 'Marte' })).toContain(
      'No encuentro la ubicación «Marte»'
    );
  });

  it('ejecutar: DELETE con el id resuelto', async () => {
    const r = await action('delete_location').ejecutar(execCtx(), {
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
      checkpoints: 3,
      rutas: 1,
    });
    expect(pt.writes).toEqual([
      { op: 'deleteLocation', input: { id: 'loc-central' }, token: 'jwt' },
    ]);
    expect(r.texto).toBe(
      '✅ Ubicación «Sede Central» borrada de Empresa Demo, junto con 3 checkpoints y 1 ruta. Los escaneos se conservan.'
    );
  });

  it('resumen: avisa en MAYÚSCULAS de lo que se borra y de que no se puede deshacer', () => {
    const p = { ubicacion: 'Sede Central', checkpoints: 3, rutas: 1 };
    const d = action('delete_location');
    expect(d.resumen(p, es)).toBe(
      'Borrar la ubicación «Sede Central» de Empresa Demo.\n' +
        '⚠️ SE BORRARÁN TODOS SUS CHECKPOINTS (3, TAMBIÉN LOS YA ESCANEADOS), SUS RUTAS (1) Y SUS RONDAS, SU CONTROL DE ACCESO Y LOS PERMISOS DE ESA UBICACIÓN. NO SE PUEDE DESHACER. Los escaneos se conservan.'
    );
    expect(d.resumen(p, en)).toContain('CANNOT BE UNDONE');
    expect(d.resumen(p, fr)).toContain('IRRÉVERSIBLE');
  });

  it('la descripción propone archivar los checkpoints si solo quiere que dejen de contar', () => {
    expect(action('delete_location').descripcion).toContain('proponer_archivar_checkpoint');
  });
});

describe('invite_user', () => {
  it('preparar: por defecto VIEWER de toda la organización, email normalizado', async () => {
    const p = await prepared('invite_user', { nombre: 'Luis Mora', email: ' Luis@Acme.test ' });
    expect(p).toMatchObject({ nombre: 'Luis Mora', email: 'luis@acme.test', rol: 'VIEWER' });
    expect(p.ubicacion_id).toBeUndefined();
  });

  it('preparar: email con formato inválido → error claro', async () => {
    expect(await prepError('invite_user', { nombre: 'Luis', email: 'luis@' })).toContain('email');
  });

  it('preparar: con ubicación, su id sale SOLO de las ubicaciones de la organización', async () => {
    const p = await prepared('invite_user', {
      nombre: 'Luis',
      email: 'luis@acme.test',
      ubicacion: 'norte',
      ubicacion_id: 'loc-de-otra-org',
    });
    expect(p).toMatchObject({ ubicacion: 'Sucursal Norte', ubicacion_id: 'loc-norte' });
    expect(
      await prepError('invite_user', {
        nombre: 'Luis',
        email: 'luis@acme.test',
        ubicacion: 'Marte',
      })
    ).toContain('No encuentro la ubicación «Marte»');
  });

  it('preparar: EDITOR o ADMIN con los asientos de gestor llenos → error; VIEWER no ocupa asiento', async () => {
    pt.planUsage = {
      ...pt.planUsage,
      uso: { ...pt.planUsage.uso!, gestores: { usados: 3, limite: 3 } },
    };
    const error = await prepError('invite_user', {
      nombre: 'Luis',
      email: 'luis@acme.test',
      rol: 'EDITOR',
    });
    expect(error).toContain('límite de gestores');
    expect(error).toContain('VIEWER');
    expect(
      await prepared('invite_user', { nombre: 'Luis', email: 'luis@acme.test', rol: 'VIEWER' })
    ).toMatchObject({ rol: 'VIEWER' });
  });

  it('preparar: si esa persona ya tiene acceso en ese mismo ámbito, no lo propone', async () => {
    expect(await prepError('invite_user', { nombre: 'Marta', email: 'marta@acme.test' })).toContain(
      'ya tiene acceso'
    );
    // Pedro es VIEWER de Sucursal Norte: a toda la organización sí se le puede invitar.
    expect(
      await prepared('invite_user', { nombre: 'Pedro', email: 'pedro@acme.test' })
    ).toMatchObject({ email: 'pedro@acme.test' });
    expect(
      await prepError('invite_user', {
        nombre: 'Pedro',
        email: 'pedro@acme.test',
        ubicacion: 'norte',
      })
    ).toContain('ya tiene acceso');
  });

  it('ejecutar: POST SOLO con los campos de la whitelist, sin `id`, con la organización de la sesión', async () => {
    await action('invite_user').ejecutar(execCtx(), {
      nombre: 'Luis',
      email: 'luis@acme.test',
      rol: 'VIEWER',
    });
    await action('invite_user').ejecutar(execCtx(), {
      nombre: 'Luis',
      email: 'luis@acme.test',
      rol: 'EDITOR',
      ubicacion: 'Sucursal Norte',
      ubicacion_id: 'loc-norte',
    });
    expect(pt.writes).toEqual([
      {
        op: 'inviteUser',
        input: {
          organizationId: 'org-1',
          name: 'Luis',
          email: 'luis@acme.test',
          roleType: 'VIEWER',
          roleScope: 'ORGANIZATION',
        },
        token: 'jwt',
      },
      {
        op: 'inviteUser',
        input: {
          organizationId: 'org-1',
          name: 'Luis',
          email: 'luis@acme.test',
          roleType: 'EDITOR',
          roleScope: 'LOCATION',
          locationId: 'loc-norte',
        },
        token: 'jwt',
      },
    ]);
  });

  it('ejecutar: explica el correo y los 72 h; si ya tenía cuenta, solo se añade el rol; sin correo, «¿Olvidaste tu contraseña?»', async () => {
    const p = { nombre: 'Luis', email: 'luis@acme.test', rol: 'VIEWER' };
    const nuevo = await action('invite_user').ejecutar(execCtx(), p);
    expect(nuevo.texto).toContain('Te han invitado a PatrolTech');
    expect(nuevo.texto).toContain('72 h');

    pt.inviteResult = { cuentaNueva: false, emailEnviado: true };
    const existente = await action('invite_user').ejecutar(execCtx('en'), p);
    expect(existente.texto).toContain('already had a PatrolTech account');

    pt.inviteResult = { cuentaNueva: true, emailEnviado: false };
    const sinCorreo = await action('invite_user').ejecutar(execCtx('fr'), p);
    expect(sinCorreo.texto).toContain('Mot de passe oublié');
  });

  it('resumen es/en/fr con el rol y el ámbito', () => {
    const d = action('invite_user');
    const org = { nombre: 'Luis Mora', email: 'luis@acme.test', rol: 'VIEWER' };
    expect(d.resumen(org, es)).toBe(
      'Invitar a Luis Mora (luis@acme.test) al panel de Empresa Demo como Viewer (solo ver) de toda la organización. Si aún no tiene cuenta en PatrolTech, le llegará un correo para crear su contraseña.'
    );
    const loc = { ...org, rol: 'EDITOR', ubicacion: 'Sucursal Norte' };
    expect(d.resumen(loc, en)).toBe(
      "Invite Luis Mora (luis@acme.test) to the Empresa Demo dashboard as Editor of the location «Sucursal Norte». If they don't have a PatrolTech account yet, they'll get an email to set their password."
    );
    expect(d.resumen(org, fr)).toContain('Inviter Luis Mora');
  });
});

describe('errores de la API en ubicaciones e invitaciones', () => {
  it('402 USER_LIMIT_REACHED: límite de gestores, y que un Viewer no ocupa plaza', () => {
    const err = new PatrolTechApiError(402, '/api/organizations/users', {
      code: 'USER_LIMIT_REACHED',
      message: 'Has alcanzado el límite de usuarios de tu plan (3).',
    });
    const es = translateBackendError(err, 'es');
    expect(es.kind).toBe('plan_limit');
    expect(es.mensajeCliente).toContain('Has alcanzado el límite de usuarios de tu plan (3).');
    expect(es.mensajeCliente).toContain('Viewer');
    expect(translateBackendError(err, 'en').mensajeCliente).toContain('Viewer');
    expect(translateBackendError(err, 'fr').mensajeCliente).toContain('Viewer');
  });
});
