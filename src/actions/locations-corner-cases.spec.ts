import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { actionCatalog } from './index.js';
import { roleAllows, type ActionDefinition, type ActionPrepareContext } from './types.js';
import type { OrganizationRef } from '../context.js';
import { FakePatrolTechGateway } from '../testing/FakePatrolTechGateway.js';

/**
 * Casos límite de editar y borrar ubicaciones e invitar al panel, pensados
 * como un usuario de un chat: nombres repetidos, emails pegados de una
 * frase, personas que ya están en la organización, lotes con reintentos.
 */

const ORG = { orgId: 'org-1', name: 'Empresa Demo' };
const prepCtx: ActionPrepareContext = {
  org: ORG,
  organizations: [ORG],
  token: 'jwt',
  country: 'ES',
  language: 'es',
  tz: 'Europe/Madrid',
  user: { id: 'u-yo', name: 'Ana García' },
};

let pt: FakePatrolTechGateway;
let catalog: ActionDefinition[];
const action = (nombre: string): ActionDefinition => catalog.find((d) => d.nombre === nombre)!;

async function prep(nombre: string, params: Record<string, unknown>) {
  return action(nombre).preparar!(prepCtx, params);
}
async function prepared(
  nombre: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const r = await prep(nombre, params);
  if ('error' in r) throw new Error(`preparar falló: ${r.error}`);
  return r.params;
}
async function prepError(nombre: string, params: Record<string, unknown>): Promise<string> {
  const r = await prep(nombre, params);
  if (!('error' in r)) throw new Error(`preparar debía fallar: ${JSON.stringify(r.params)}`);
  return r.error;
}

beforeEach(() => {
  pt = new FakePatrolTechGateway();
  pt.locations = [
    { id: 'loc-central', name: 'Sede Central', address: 'Calle Mayor 1' },
    { id: 'loc-norte', name: 'Sucursal Norte', address: 'Av. del Norte 5' },
  ];
  pt.planUsage = {
    ...pt.planUsage,
    uso: { ...pt.planUsage.uso!, gestores: { usados: 1, limite: 3 } },
  };
  catalog = actionCatalog({ gateway: pt });
});

describe('ubicaciones: cómo las nombra el cliente', () => {
  it('mayúsculas y espacios alrededor no importan', async () => {
    expect(
      await prepared('edit_location', { ubicacion: '  SUCURSAL norte ', nombre: 'Norte' })
    ).toMatchObject({ ubicacion_id: 'loc-norte' });
  });

  it('el nombre exacto gana a otra ubicación que lo contiene («Norte» frente a «Sucursal Norte»)', async () => {
    pt.locations.push({ id: 'loc-n', name: 'Norte', address: null });
    expect(await prepared('delete_location', { ubicacion: 'norte' })).toMatchObject({
      ubicacion_id: 'loc-n',
    });
  });

  it('un trozo que casa con varias → pregunta cuál, sin elegir en silencio', async () => {
    pt.locations.push({ id: 'loc-sur', name: 'Sucursal Sur', address: null });
    const error = await prepError('delete_location', { ubicacion: 'sucursal' });
    expect(error).toContain('Hay varias ubicaciones');
    expect(pt.writes).toEqual([]);
  });

  it('sin tildes y con espacios de más también casa («almacen  logistico» → «Almacén Logístico»)', async () => {
    pt.locations = [{ id: 'loc-a', name: 'Almacén Logístico', address: null }, ...pt.locations];
    expect(
      await prepared('edit_location', { ubicacion: 'almacen  logistico', nombre: 'X' })
    ).toMatchObject({ ubicacion_id: 'loc-a' });
  });

  it('dos ubicaciones con el MISMO nombre: las opciones se distinguen (dirección y número) y se puede elegir por número', async () => {
    pt.locations = [
      { id: 'loc-a', name: 'Oficina', address: 'Calle A 1' },
      { id: 'loc-b', name: 'Oficina', address: 'Calle B 2' },
      { id: 'loc-c', name: 'Almacén', address: null },
    ];
    const error = await prepError('delete_location', { ubicacion: 'Oficina' });
    expect(error).toContain('1. «Oficina» (Calle A 1)');
    expect(error).toContain('2. «Oficina» (Calle B 2)');
    // El cliente contesta «la segunda» → el modelo pasa el número.
    expect(await prepared('delete_location', { ubicacion: '2' })).toMatchObject({
      ubicacion: 'Oficina',
      ubicacion_id: 'loc-b',
    });
  });

  it('crear checkpoint o ruta con dos ubicaciones del mismo nombre: mismas opciones numeradas y se elige por número (helper compartido)', async () => {
    pt.locations = [
      { id: 'loc-a', name: 'Oficina', address: 'Calle A 1' },
      { id: 'loc-b', name: 'Oficina', address: 'Calle B 2' },
    ];
    pt.planUsage = {
      ...pt.planUsage,
      uso: { ...pt.planUsage.uso!, checkpoints: { usados: 1, incluidos: 5, extraFacturados: 0 } },
    };
    const sinDecir = await prepError('create_checkpoint', { nombre: 'Entrada', metodo: 'qr' });
    expect(sinDecir).toContain('pregúntale en cuál crear el checkpoint');
    expect(sinDecir).toContain('1. «Oficina» (Calle A 1), 2. «Oficina» (Calle B 2)');
    expect(
      await prepError('create_checkpoint', {
        nombre: 'Entrada',
        metodo: 'qr',
        ubicacion: 'oficina',
      })
    ).toContain('Hay varias ubicaciones');
    expect(
      await prepared('create_checkpoint', { nombre: 'Entrada', metodo: 'qr', ubicacion: '2' })
    ).toMatchObject({ ubicacion_id: 'loc-b' });
    expect(
      await prepError('create_route', { nombre: 'Ronda', checkpoints: ['Entrada'] })
    ).toContain('2. «Oficina» (Calle B 2)');
  });

  it('crear un checkpoint: con nombres distintos, «2» NO es la segunda ubicación (solo con repetidos)', async () => {
    expect(
      await prepError('create_checkpoint', { nombre: 'Entrada', metodo: 'qr', ubicacion: '2' })
    ).toContain('No encuentro la ubicación «2»');
  });

  it('con nombres distintos, las opciones siguen siendo solo los nombres', async () => {
    expect(await prepError('edit_location', { nombre: 'X' })).toContain(
      '«Sede Central», «Sucursal Norte»'
    );
  });

  it('una organización sin ubicaciones (backend raro) → error claro, sin llamar a nada más', async () => {
    pt.locations = [];
    expect(await prepError('edit_location', { nombre: 'X' })).toContain('no tiene ubicaciones');
    expect(await prepError('delete_location', { ubicacion: 'X' })).toContain(
      'no tiene ubicaciones'
    );
    expect(
      await prepError('invite_user', { nombre: 'Luis', email: 'luis@acme.test', ubicacion: 'X' })
    ).toContain('no tiene ubicaciones');
  });
});

describe('edit_location: qué cambia', () => {
  it('solo la dirección, igual salvo espacios → nada que cambiar', async () => {
    pt.locations[0] = { ...pt.locations[0], address: '  Calle Mayor 1 ' };
    expect(
      await prepError('edit_location', { ubicacion: 'Sede Central', direccion: 'Calle Mayor 1' })
    ).toContain('nada que cambiar');
  });

  it('una ubicación SIN dirección: poner una no muestra «antes»', async () => {
    pt.locations[0] = { ...pt.locations[0], address: null };
    const p = await prepared('edit_location', {
      ubicacion: 'Sede Central',
      direccion: 'Calle Nueva 3',
    });
    expect(p.direccion_actual).toBeUndefined();
    expect(action('edit_location').resumen(p, { idioma: 'en', organizacion: 'Empresa Demo' })).toBe(
      'Change the location «Sede Central» of Empresa Demo: address → «Calle Nueva 3».'
    );
  });

  it('renombrarla como OTRA ubicación (aunque cambien mayúsculas, tildes o espacios) se rechaza', async () => {
    pt.locations.push({ id: 'loc-a', name: 'Almacén', address: null });
    expect(
      await prepError('edit_location', { ubicacion: 'Sede Central', nombre: ' sucursal  NORTE ' })
    ).toContain('Ya hay otra ubicación que se llama «Sucursal Norte»');
    expect(
      await prepError('edit_location', { ubicacion: 'Sede Central', nombre: 'almacen' })
    ).toContain('«Almacén»');
  });

  it('cambiar solo mayúsculas del nombre SÍ es un cambio', async () => {
    expect(
      await prepared('edit_location', { ubicacion: 'Sede Central', nombre: 'SEDE CENTRAL' })
    ).toMatchObject({ nombre: 'SEDE CENTRAL' });
  });

  it('cadenas vacías o solo espacios no pasan la validación de parámetros (no se manda una dirección vacía)', () => {
    const schema = z.object(action('edit_location').params);
    expect(schema.safeParse({ ubicacion: 'Sede Central', direccion: '   ' }).success).toBe(false);
    expect(schema.safeParse({ ubicacion: 'Sede Central', nombre: '' }).success).toBe(false);
  });

  it('ejecutar en francés con el nombre nuevo', async () => {
    const r = await action('edit_location').ejecutar(
      { ...prepCtx, language: 'fr', user: { id: 'u', name: 'Ana' }, idempotencyKey: null },
      { ubicacion: 'Sede Central', ubicacion_id: 'loc-central', nombre: 'Siège' }
    );
    expect(r.texto).toBe('✅ Site «Siège» de Empresa Demo mis à jour.');
  });
});

describe('delete_location: cuentas', () => {
  it('solo cuenta los checkpoints y rutas de ESA ubicación (activos + archivados); sin ninguno, 0', async () => {
    pt.checkpointRefs = [];
    pt.archivedCheckpointRefs = [];
    pt.routes = [{ id: 'r1', name: 'R', isActive: true, locationId: 'loc-central' }];
    expect(await prepared('delete_location', { ubicacion: 'Sucursal Norte' })).toMatchObject({
      checkpoints: 0,
      rutas: 0,
    });
  });

  it('el texto final en singular/plural en inglés', async () => {
    const r = await action('delete_location').ejecutar(
      { ...prepCtx, language: 'en', user: { id: 'u', name: 'Ana' }, idempotencyKey: null },
      { ubicacion: 'Sucursal Norte', ubicacion_id: 'loc-norte', checkpoints: 1, rutas: 0 }
    );
    expect(r.texto).toBe(
      '✅ Location «Sucursal Norte» deleted from Empresa Demo, along with 1 checkpoint and 0 routes. Scans are kept.'
    );
  });
});

describe('invite_user: emails como llegan por WhatsApp', () => {
  it.each([
    'luis@acme.test.',
    'luis@acme.test,',
    '<luis@acme.test>',
    'Luis Mora <luis@acme.test>',
    'luis@acme',
    'luis@@acme.test',
    'luis@ acme.test',
  ])('rechaza «%s» y pide el email de nuevo', async (email) => {
    expect(await prepError('invite_user', { nombre: 'Luis', email })).toContain(
      'no parece un email válido'
    );
  });

  it.each(['luis.mora+panel@seguridad.acme.test', 'LUIS@ACME.TEST', 'josé@empresa.test'])(
    'acepta «%s»',
    async (email) => {
      expect(await prepared('invite_user', { nombre: 'Luis', email })).toMatchObject({
        email: email.toLowerCase(),
      });
    }
  );

  it('si ya está en la organización con otra capitalización, se usa el email TAL CUAL lo tiene guardado (el backend compara exacto)', async () => {
    pt.orgUsers = [
      {
        id: 'u-p',
        nombre: 'Pedro Gil',
        email: 'Pedro.Gil@Acme.test',
        roles: [{ id: 'r-p', rol: 'VIEWER', ambito: 'LOCATION', scopeId: 'loc-norte' }],
      },
    ];
    // Mismo ámbito: ya tiene acceso, aunque lo escriban distinto.
    expect(
      await prepError('invite_user', {
        nombre: 'Pedro',
        email: 'pedro.gil@acme.TEST',
        ubicacion: 'norte',
      })
    ).toContain('ya tiene acceso');
    // Otro ámbito: se invita con SU email, no con uno nuevo en minúsculas (sería otra cuenta).
    expect(
      await prepared('invite_user', { nombre: 'Pedro', email: 'pedro.gil@acme.test' })
    ).toMatchObject({ email: 'Pedro.Gil@Acme.test' });
  });
});

describe('invite_user: roles, ámbitos y asientos', () => {
  it('ya es ADMIN de la organización y los asientos están llenos → «ya tiene acceso», no «límite de gestores»', async () => {
    pt.planUsage = {
      ...pt.planUsage,
      uso: { ...pt.planUsage.uso!, gestores: { usados: 3, limite: 3 } },
    };
    const error = await prepError('invite_user', {
      nombre: 'Marta',
      email: 'marta@acme.test',
      rol: 'ADMIN',
    });
    expect(error).toContain('ya tiene acceso');
    expect(error).not.toContain('límite');
  });

  it('VIEWER no consulta el plan; con plan sin límite de gestores (null) un EDITOR pasa', async () => {
    const spy = { n: 0 };
    const original = pt.getPlanUsage.bind(pt);
    pt.getPlanUsage = async (...a) => {
      spy.n += 1;
      return original(...a);
    };
    await prepared('invite_user', { nombre: 'Luis', email: 'luis@acme.test' });
    expect(spy.n).toBe(0);
    pt.planUsage = {
      ...pt.planUsage,
      uso: { ...pt.planUsage.uso!, gestores: { usados: 50, limite: null } },
    };
    expect(
      await prepared('invite_user', { nombre: 'Luis', email: 'luis@acme.test', rol: 'EDITOR' })
    ).toMatchObject({ rol: 'EDITOR' });
  });

  it('con un rol de TODA la organización, invitarla a una ubicación se rechaza (ya la ve)', async () => {
    const error = await prepError('invite_user', {
      nombre: 'Marta',
      email: 'marta@acme.test',
      ubicacion: 'Sede Central',
      rol: 'EDITOR',
    });
    expect(error).toContain('ya tiene acceso a toda la organización como ADMIN');
  });

  it('con un rol de OTRA ubicación, invitarla a esta sí se permite', async () => {
    expect(
      await prepared('invite_user', {
        nombre: 'Pedro',
        email: 'pedro@acme.test',
        ubicacion: 'Sede Central',
      })
    ).toMatchObject({
      ubicacion_id: 'loc-central',
    });
  });

  it('un admin de UBICACIÓN no puede invitar ni borrar ubicaciones (ni aparecen sus tools); editar sí', () => {
    // El filtro por canal y por flags (`availableBotActions`) es del motor del bot; el de rol, de aquí.
    const sesion = (roleType: string, scope: 'organization' | 'location'): OrganizationRef => ({
      orgId: 'org-1',
      name: 'Empresa Demo',
      roleType,
      scope,
    });
    const nombres = (o: OrganizationRef) =>
      catalog
        .filter((d) => roleAllows(d, o))
        .map((d) => d.nombre)
        .filter((n) => ['edit_location', 'delete_location', 'invite_user'].includes(n));
    expect(nombres(sesion('ADMIN', 'location'))).toEqual(['edit_location']);
    expect(nombres(sesion('ADMIN', 'organization'))).toEqual([
      'edit_location',
      'delete_location',
      'invite_user',
    ]);
    expect(nombres(sesion('EDITOR', 'organization'))).toEqual(['edit_location']);
    expect(nombres(sesion('VIEWER', 'organization'))).toEqual([]);
    expect(nombres(sesion('viewer', 'organization'))).toEqual([]);
  });

  it('resumen en francés de una invitación a una ubicación', () => {
    expect(
      action('invite_user').resumen(
        { nombre: 'Luis', email: 'luis@acme.test', rol: 'ADMIN', ubicacion: 'Sucursal Norte' },
        { idioma: 'fr', organizacion: 'Empresa Demo' }
      )
    ).toBe(
      "Inviter Luis (luis@acme.test) sur le tableau de bord de Empresa Demo en tant que Admin du site «Sucursal Norte». Si cette personne n'a pas encore de compte PatrolTech, elle recevra un e-mail pour créer son mot de passe."
    );
  });
});

// «Un borrado de ubicación por confirmación» es una regla del colector del lote (motor del bot): sus tests siguen allí.
