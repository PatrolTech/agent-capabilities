import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { actionCatalog } from './index.js';
import type { ActionContext, ActionDefinition, ActionPrepareContext } from './types.js';
import { AccionRechazada } from './names.js';
import { distanciaMetros, enlaceMapa, formatoDistancia } from '../domain/geo.js';
import type { FixedTextLanguage } from '../domain/language.js';
import { FakePatrolTechGateway } from '../testing/FakePatrolTechGateway.js';

/**
 * Casos límite de antifraude, mover checkpoint y roles de usuarios: lo que no
 * cubren los tests de cada acción y que un usuario acaba provocando.
 */

const ORG = { orgId: 'org-1', name: 'Empresa Demo' };
const YO = { id: 'u-yo', name: 'Ana García' };
const prepCtx = (
  idioma: FixedTextLanguage = 'es',
  user: { id: string; name: string } = YO
): ActionPrepareContext => ({
  org: ORG,
  organizations: [ORG],
  token: 'jwt',
  country: 'ES',
  language: idioma,
  tz: 'Europe/Madrid',
  user,
});
const execCtx = (
  idioma: FixedTextLanguage = 'es',
  user: { id: string; name: string } = YO
): ActionContext => ({
  ...prepCtx(idioma, user),
  user,
  idempotencyKey: null,
});

let pt: FakePatrolTechGateway;
let catalog: ActionDefinition[];
const action = (nombre: string): ActionDefinition => catalog.find((d) => d.nombre === nombre)!;

async function prepared(
  nombre: string,
  params: Record<string, unknown>,
  ctx = prepCtx()
): Promise<Record<string, unknown>> {
  const r = await action(nombre).preparar!(ctx, params);
  if ('error' in r) throw new Error(`preparar falló: ${r.error}`);
  return r.params;
}
async function prepError(
  nombre: string,
  params: Record<string, unknown>,
  ctx = prepCtx()
): Promise<string> {
  const r = await action(nombre).preparar!(ctx, params);
  if (!('error' in r)) throw new Error(`preparar debía fallar: ${JSON.stringify(r.params)}`);
  return r.error;
}
const valida = (nombre: string, params: Record<string, unknown>) =>
  z.object(action(nombre).params).safeParse(params).success;

beforeEach(() => {
  pt = new FakePatrolTechGateway();
  catalog = actionCatalog({ gateway: pt });
});

describe('edit_checkpoint_antifraud: casos límite', () => {
  beforeEach(() => {
    pt.checkpointGeo['cp-entrada'] = {
      latitud: 40.4,
      longitud: -3.7,
      reglasAntifraude: { undergroundMode: { enabled: true } },
    };
  });

  it('con solo el modo subterráneo, poner una distancia activa la proximidad GPS y conserva el subterráneo (sin inventar precisión)', async () => {
    const p = await prepared('edit_checkpoint_antifraud', {
      checkpoint: 'entrada',
      distancia_maxima_m: 80,
    });
    expect(p.reglas_despues).toEqual({
      gpsProximity: { maxDistanceMeters: 80 },
      undergroundMode: { enabled: true },
    });
  });

  it('solo la precisión: con la proximidad apagada la activa a 100 m (y el resumen lo dice); con ella encendida conserva la distancia', async () => {
    const p = await prepared('edit_checkpoint_antifraud', {
      checkpoint: 'entrada',
      precision_maxima_m: 30,
    });
    expect(p.reglas_despues).toEqual({
      gpsProximity: { maxDistanceMeters: 100, maxAccuracyMeters: 30 },
      undergroundMode: { enabled: true },
    });
    expect(
      action('edit_checkpoint_antifraud').resumen(p, { idioma: 'es', organizacion: 'Empresa Demo' })
    ).toContain('proximidad GPS: desactivada → máx. 100 m (precisión GPS máx. 30 m)');
    pt.checkpointGeo['cp-entrada'].reglasAntifraude = { gpsProximity: { maxDistanceMeters: 40 } };
    expect(
      (
        await prepared('edit_checkpoint_antifraud', {
          checkpoint: 'entrada',
          precision_maxima_m: 30,
        })
      ).reglas_despues
    ).toEqual({
      gpsProximity: { maxDistanceMeters: 40, maxAccuracyMeters: 30 },
    });
  });

  it('apagar lo que ya está apagado no se propone', async () => {
    expect(
      await prepError('edit_checkpoint_antifraud', { checkpoint: 'entrada', proximidad_gps: false })
    ).toContain('ya tiene esas reglas');
    pt.checkpointGeo['cp-entrada'].reglasAntifraude = { undergroundMode: { enabled: false } };
    expect(
      await prepError('edit_checkpoint_antifraud', {
        checkpoint: 'entrada',
        modo_subterraneo: false,
      })
    ).toContain('ya tiene esas reglas');
  });

  it('distancia: 10 y 5000 valen; 9, 5001, decimales y texto no (el error vuelve al modelo, no se redondea en silencio)', () => {
    for (const d of [10, 5000])
      expect(valida('edit_checkpoint_antifraud', { checkpoint: 'x', distancia_maxima_m: d })).toBe(
        true
      );
    for (const d of [9, 5001, 50.5, '100', NaN])
      expect(valida('edit_checkpoint_antifraud', { checkpoint: 'x', distancia_maxima_m: d })).toBe(
        false
      );
  });

  it('sin posición guardada: apagar la proximidad sí; tocar la precisión no', async () => {
    pt.checkpointGeo['cp-entrada'] = {
      latitud: null,
      longitud: null,
      reglasAntifraude: { gpsProximity: { maxDistanceMeters: 30 } },
    };
    expect(
      (
        await prepared('edit_checkpoint_antifraud', {
          checkpoint: 'entrada',
          proximidad_gps: false,
        })
      ).reglas_despues
    ).toEqual({});
    expect(
      await prepError('edit_checkpoint_antifraud', {
        checkpoint: 'entrada',
        precision_maxima_m: 20,
      })
    ).toContain('no tiene posición');
  });

  it('un checkpoint archivado no está entre los que se pueden cambiar', async () => {
    pt.archivedCheckpointRefs = [{ ...pt.checkpointRefs[0], id: 'cp-viejo', name: 'Garita vieja' }];
    expect(
      await prepError('edit_checkpoint_antifraud', {
        checkpoint: 'Garita vieja',
        modo_subterraneo: true,
      })
    ).toContain('No encuentro');
  });

  it('dos checkpoints con el mismo nombre en ubicaciones distintas: pregunta cuál; con la ubicación, ese', async () => {
    pt.checkpointRefs.push({
      id: 'cp-entrada-norte',
      name: 'Entrada principal',
      locationId: 'loc-norte',
      locationName: 'Sucursal Norte',
      metodo: 'qr_static',
      codigo: null,
    });
    pt.checkpointGeo['cp-entrada-norte'] = { latitud: 41, longitud: 2 };
    const error = await prepError('edit_checkpoint_antifraud', {
      checkpoint: 'Entrada principal',
      modo_subterraneo: true,
    });
    expect(error).toContain('Entrada principal (Sede Central)');
    expect(error).toContain('Entrada principal (Sucursal Norte)');
    expect(
      await prepared('edit_checkpoint_antifraud', {
        checkpoint: 'Entrada principal',
        ubicacion: 'norte',
        modo_subterraneo: true,
      })
    ).toMatchObject({
      checkpoint_id: 'cp-entrada-norte',
      ubicacion_id: 'loc-norte',
      ubicacion: 'Sucursal Norte',
    });
  });

  it('lote «sube a 50 m los puntos 1 al 5»: cinco propuestas; cada ejecución relee SU punto (y «Punto 1» no coge «Punto 10»)', async () => {
    pt.checkpointRefs = Array.from({ length: 10 }, (_, i) => ({
      id: `cp-${i + 1}`,
      name: `Punto ${i + 1}`,
      locationId: 'loc-central',
      locationName: 'Sede Central',
      metodo: 'qr_static',
      codigo: null,
    }));
    for (let i = 1; i <= 10; i++)
      pt.checkpointGeo[`cp-${i}`] = {
        latitud: 40 + i / 1000,
        longitud: -3.7,
        reglasAntifraude: { gpsProximity: { maxDistanceMeters: 20 } },
      };
    const lote = [];
    for (let i = 1; i <= 5; i++)
      lote.push(
        await prepared('edit_checkpoint_antifraud', {
          checkpoint: `Punto ${i}`,
          distancia_maxima_m: 50,
        })
      );
    expect(lote.map((p) => p.checkpoint_id)).toEqual(['cp-1', 'cp-2', 'cp-3', 'cp-4', 'cp-5']);
    // Entre la propuesta y el «Confirmar», el punto 3 gana el modo subterráneo desde el panel: no se pierde.
    pt.checkpointGeo['cp-3'].reglasAntifraude = {
      gpsProximity: { maxDistanceMeters: 20 },
      undergroundMode: { enabled: true },
    };

    for (const p of lote) await action('edit_checkpoint_antifraud').ejecutar(execCtx(), p);

    expect(pt.writes.map((w) => w.input)).toEqual([
      { id: 'cp-1', fraudRules: { gpsProximity: { maxDistanceMeters: 50 } } },
      { id: 'cp-2', fraudRules: { gpsProximity: { maxDistanceMeters: 50 } } },
      {
        id: 'cp-3',
        fraudRules: { gpsProximity: { maxDistanceMeters: 50 }, undergroundMode: { enabled: true } },
      },
      { id: 'cp-4', fraudRules: { gpsProximity: { maxDistanceMeters: 50 } } },
      { id: 'cp-5', fraudRules: { gpsProximity: { maxDistanceMeters: 50 } } },
    ]);
  });

  it('al confirmar, si el punto ya no está o tiene reglas que no conoce: AccionRechazada en su idioma y ningún PUT', async () => {
    const p = await prepared('edit_checkpoint_antifraud', {
      checkpoint: 'entrada',
      modo_subterraneo: false,
    });
    pt.checkpointGeo['cp-entrada'].reglasDesconocidas = ['wifiCheck'];
    await expect(action('edit_checkpoint_antifraud').ejecutar(execCtx('en'), p)).rejects.toThrow(
      /No changes have been made: the checkpoint «Entrada principal» now has anti-fraud rules/
    );
    pt.checkpointRefs = pt.checkpointRefs.filter((c) => c.id !== 'cp-entrada');
    const r = action('edit_checkpoint_antifraud').ejecutar(execCtx('fr'), p);
    await expect(r).rejects.toBeInstanceOf(AccionRechazada);
    await expect(r).rejects.toThrow(
      "Aucune modification n'a été effectuée : le checkpoint «Entrada principal» n'est plus sur le site «Sede Central»"
    );
    expect(pt.writes).toEqual([]);
  });
});

describe('move_checkpoint: casos límite', () => {
  beforeEach(() => {
    pt.checkpointGeo['cp-entrada'] = { latitud: 40.4168, longitud: -3.7038 };
  });

  it('latitud y longitud al revés: no lo propone (se iría a miles de km)', async () => {
    const error = await prepError('move_checkpoint', {
      checkpoint: 'entrada',
      latitud: -3.7039,
      longitud: 40.4169,
    });
    expect(error).toContain('al revés');
  });

  it('un traslado lejano de verdad (no es el par girado) sí se propone, y el resumen dice la distancia', async () => {
    const p = await prepared('move_checkpoint', {
      checkpoint: 'entrada',
      latitud: 41.3874,
      longitud: 2.1686,
    });
    expect(
      action('move_checkpoint').resumen(p, { idioma: 'es', organizacion: 'Empresa Demo' })
    ).toMatch(/a 50\d km de la anterior/);
  });

  it('coordenadas como texto («40,4168») o fuera de rango no pasan la validación; los extremos sí', () => {
    expect(
      valida('move_checkpoint', { checkpoint: 'x', latitud: '40,4168', longitud: '-3,7038' })
    ).toBe(false);
    expect(valida('move_checkpoint', { checkpoint: 'x', latitud: '40.4168', longitud: -3.7 })).toBe(
      false
    );
    expect(valida('move_checkpoint', { checkpoint: 'x', latitud: 90.0001, longitud: 0 })).toBe(
      false
    );
    expect(valida('move_checkpoint', { checkpoint: 'x', latitud: 90, longitud: -180 })).toBe(true);
  });

  it('sin posición guardada no hay comprobación de giro: se propone y el resumen lo dice', async () => {
    pt.checkpointGeo['cp-entrada'] = { latitud: null, longitud: null };
    const p = await prepared('move_checkpoint', {
      checkpoint: 'entrada',
      latitud: -3.7,
      longitud: 40.4,
    });
    expect(p.latitud_actual).toBeUndefined();
    expect(
      action('move_checkpoint').resumen(p, { idioma: 'en', organizacion: 'Empresa Demo' })
    ).toContain('(it had no saved position)');
  });
});

// El marcador de ubicación compartida (`locationMarker`) es del canal: su test sigue en el bot.
describe('geo', () => {
  it('haversine a través del antimeridiano: la distancia corta, no la vuelta al mundo', () => {
    const d = distanciaMetros({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    expect(d).toBeGreaterThan(22_000);
    expect(d).toBeLessThan(22_500);
    expect(distanciaMetros({ lat: 90, lng: 0 }, { lat: 90, lng: 180 })).toBeLessThan(1);
  });

  it('formato: lo que redondea a 1000 m ya va en km; desde 100 km sin decimales; coma en es y fr', () => {
    expect(formatoDistancia(999.4, 'es')).toBe('999 m');
    expect(formatoDistancia(999.6, 'es')).toBe('1,0 km');
    expect(formatoDistancia(3300, 'en')).toBe('3.3 km');
    expect(formatoDistancia(3300, 'fr')).toBe('3,3 km');
    expect(formatoDistancia(123_456, 'es')).toBe('123 km');
  });

  it('enlace de Google Maps con «lat,lng» tal cual', () => {
    expect(enlaceMapa(-33.8688, 151.2093)).toBe('https://www.google.com/maps?q=-33.8688,151.2093');
  });
});

describe('roles de usuarios: casos límite', () => {
  beforeEach(() => {
    pt.orgUsers = [
      {
        id: 'u-yo',
        nombre: 'Ana García',
        email: 'Ana@Acme.test',
        roles: [{ id: 'r-yo', rol: 'ADMIN', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
      },
      {
        id: 'u-marta',
        nombre: 'Marta Ruiz',
        email: 'marta@acme.test',
        roles: [{ id: 'r-marta', rol: 'ADMIN', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
      },
      {
        id: 'u-xavi',
        nombre: 'Xavi Sol',
        email: 'xavi@acme.test',
        roles: [{ id: 'r-xavi', rol: 'ADMIN', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
      },
      {
        id: 'u-pedro',
        nombre: 'Pedro Gil',
        email: 'pedro@acme.test',
        roles: [{ id: 'r-pedro', rol: 'VIEWER', ambito: 'LOCATION', scopeId: 'loc-norte' }],
      },
      {
        id: 'u-lola',
        nombre: 'Lola Vega',
        email: 'lola@acme.test',
        roles: [{ id: 'r-lola', rol: 'ADMIN', ambito: 'LOCATION', scopeId: 'loc-norte' }],
      },
    ];
    pt.planUsage = {
      ...pt.planUsage,
      uso: { ...pt.planUsage.uso!, gestores: { usados: 4, limite: 10 } },
    };
  });

  it('dos personas con el MISMO nombre: pregunta cuál con su email; por email, la que es', async () => {
    pt.orgUsers.push({
      id: 'u-marta2',
      nombre: 'Marta Ruiz',
      email: 'mruiz@otra.test',
      roles: [{ id: 'r-m2', rol: 'VIEWER', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
    });
    const error = await prepError('remove_user_access', { usuario: 'Marta Ruiz' });
    expect(error).toContain('Marta Ruiz (marta@acme.test)');
    expect(error).toContain('Marta Ruiz (mruiz@otra.test)');
    expect(await prepared('remove_user_access', { usuario: 'MRUIZ@otra.test' })).toMatchObject({
      rol_id: 'r-m2',
    });
  });

  it('uno mismo por su email en otras mayúsculas: tampoco', async () => {
    expect(await prepError('remove_user_access', { usuario: 'ana@ACME.TEST' })).toContain(
      'tu propio'
    );
  });

  it('quien solo tiene un acceso de ubicación: el cambio es de ese acceso; bajar a un Admin de ubicación no cuenta para «el último Admin»', async () => {
    expect(await prepared('change_user_role', { usuario: 'Pedro', rol: 'EDITOR' })).toMatchObject({
      rol_id: 'r-pedro',
      ubicacion: 'Sucursal Norte',
      rol_actual: 'VIEWER',
    });
    expect(await prepared('change_user_role', { usuario: 'Lola', rol: 'VIEWER' })).toMatchObject({
      rol_id: 'r-lola',
      rol_actual: 'ADMIN',
    });
    // «el de la organización» a quien solo tiene el de ubicación no le quita el de ubicación en silencio.
    expect(
      await prepError('remove_user_access', { usuario: 'Pedro', acceso: 'organización' })
    ).toContain('No encuentro el acceso');
    expect(await prepError('remove_user_access', { usuario: 'Pedro', acceso: '0' })).toContain(
      'No hay un acceso número 0'
    );
  });

  it('subir a un VIEWER de ubicación sin plazas de gestor: no lo propone', async () => {
    pt.planUsage = {
      ...pt.planUsage,
      uso: { ...pt.planUsage.uso!, gestores: { usados: 5, limite: 5 } },
    };
    expect(await prepError('change_user_role', { usuario: 'Pedro', rol: 'ADMIN' })).toContain(
      'límite de gestores'
    );
  });

  it('el mismo rol que ya tiene en su ubicación: nada que cambiar', async () => {
    expect(await prepError('change_user_role', { usuario: 'Lola', rol: 'ADMIN' })).toContain(
      'ya es Admin de la ubicación «Sucursal Norte»'
    );
  });

  it('lote que baja a los dos Admins (quien propone es del equipo, no está en la lista): la 1 se hace y la 2 se para al confirmar', async () => {
    const equipo = { id: 'u-equipo', name: 'Soporte PatrolTech' };
    pt.orgUsers = pt.orgUsers.filter((u) => u.id !== 'u-yo');
    // Al proponer, cada una por separado deja otro Admin: las dos se proponen.
    const p1 = await prepared(
      'change_user_role',
      { usuario: 'Marta', rol: 'EDITOR' },
      prepCtx('es', equipo)
    );
    const p2 = await prepared(
      'change_user_role',
      { usuario: 'Xavi', rol: 'VIEWER' },
      prepCtx('es', equipo)
    );

    await action('change_user_role').ejecutar(execCtx('es', equipo), p1);
    const r2 = action('change_user_role').ejecutar(execCtx('es', equipo), p2);

    await expect(r2).rejects.toBeInstanceOf(AccionRechazada);
    await expect(r2).rejects.toThrow(
      'Xavi Sol es ahora el único Admin de toda la organización Empresa Demo'
    );
    expect(pt.writes.map((w) => w.input)).toEqual([{ userRoleId: 'r-marta', roleType: 'EDITOR' }]);
  });

  it('lo mismo al quitar accesos en lote: el segundo Admin no se queda fuera', async () => {
    const equipo = { id: 'u-equipo', name: 'Soporte PatrolTech' };
    pt.orgUsers = pt.orgUsers.filter((u) => u.id !== 'u-yo');
    const p1 = await prepared('remove_user_access', { usuario: 'Marta' }, prepCtx('es', equipo));
    const p2 = await prepared('remove_user_access', { usuario: 'Xavi' }, prepCtx('es', equipo));
    await action('remove_user_access').ejecutar(execCtx('es', equipo), p1);
    await expect(action('remove_user_access').ejecutar(execCtx('en', equipo), p2)).rejects.toThrow(
      'is now the only Admin'
    );
    expect(pt.writes.map((w) => w.op)).toEqual(['deleteUserRole']);
  });

  it('el acceso se quitó desde el panel entretanto: se para sin llamar al backend (que daría 403, no 404)', async () => {
    const p = await prepared('change_user_role', { usuario: 'Pedro', rol: 'EDITOR' });
    pt.orgUsers = pt.orgUsers.filter((u) => u.id !== 'u-pedro');
    const r = action('change_user_role').ejecutar(execCtx(), p);
    await expect(r).rejects.toBeInstanceOf(AccionRechazada);
    await expect(r).rejects.toThrow('Pedro Gil ya no tiene ese acceso en Empresa Demo');
    const q = await prepared('remove_user_access', { usuario: 'Lola' });
    pt.orgUsers = pt.orgUsers.map((u) => (u.id === 'u-lola' ? { ...u, roles: [] } : u));
    await expect(action('remove_user_access').ejecutar(execCtx('fr'), q)).rejects.toThrow(
      "Lola Vega n'a plus cet accès"
    );
    expect(pt.writes).toEqual([]);
  });

  it('un acceso de una ubicación ya borrada se puede quitar y se nombra como tal', async () => {
    pt.orgUsers.push({
      id: 'u-rafa',
      nombre: 'Rafa Luna',
      email: 'rafa@acme.test',
      roles: [{ id: 'r-rafa', rol: 'EDITOR', ambito: 'LOCATION', scopeId: 'loc-borrada' }],
    });
    expect(await prepared('remove_user_access', { usuario: 'Rafa' })).toMatchObject({
      rol_id: 'r-rafa',
      ubicacion: 'ubicación ya borrada',
    });
  });
});

describe('confirmar cuando el estado cambió entretanto', () => {
  it('antifraude: si al confirmar el punto ya es de geocerca o perdió su posición, no escribe una proximidad GPS que no se aplicaría', async () => {
    pt.checkpointGeo['cp-entrada'] = { latitud: 40.4, longitud: -3.7, reglasAntifraude: {} };
    const p = await prepared('edit_checkpoint_antifraud', {
      checkpoint: 'entrada',
      proximidad_gps: true,
    });

    const i = pt.checkpointRefs.findIndex((c) => c.id === 'cp-entrada');
    const original = pt.checkpointRefs[i];
    pt.checkpointRefs[i] = { ...original, metodo: 'geofence' };
    const geocerca = action('edit_checkpoint_antifraud').ejecutar(execCtx(), p);
    await expect(geocerca).rejects.toBeInstanceOf(AccionRechazada);
    await expect(geocerca).rejects.toThrow(
      'No se ha hecho ningún cambio: el checkpoint «Entrada principal» verifica ahora por geocerca'
    );
    await expect(action('edit_checkpoint_antifraud').ejecutar(execCtx('en'), p)).rejects.toThrow(
      'No changes have been made'
    );

    pt.checkpointRefs[i] = original;
    pt.checkpointGeo['cp-entrada'] = { reglasAntifraude: {} };
    const sinPosicion = action('edit_checkpoint_antifraud').ejecutar(execCtx('fr'), p);
    await expect(sinPosicion).rejects.toBeInstanceOf(AccionRechazada);
    await expect(sinPosicion).rejects.toThrow(
      "Aucune modification n'a été effectuée : le checkpoint «Entrada principal» n'a plus de position enregistrée"
    );
    expect(pt.writes).toEqual([]);

    // Desactivar la proximidad o tocar solo el modo subterráneo no necesita posición.
    const q = await prepared('edit_checkpoint_antifraud', {
      checkpoint: 'entrada',
      modo_subterraneo: true,
    });
    await action('edit_checkpoint_antifraud').ejecutar(execCtx(), q);
    expect(pt.writes.map((w) => w.op)).toEqual(['updateCheckpointFraudRules']);
  });

  describe('roles', () => {
    beforeEach(() => {
      pt.orgUsers = [
        {
          id: 'u-yo',
          nombre: 'Ana García',
          email: 'ana@acme.test',
          roles: [{ id: 'r-yo', rol: 'ADMIN', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
        },
        {
          id: 'u-pedro',
          nombre: 'Pedro Gil',
          email: 'pedro@acme.test',
          roles: [
            { id: 'r-pedro-org', rol: 'VIEWER', ambito: 'ORGANIZATION', scopeId: 'org-1' },
            { id: 'r-pedro-norte', rol: 'EDITOR', ambito: 'LOCATION', scopeId: 'loc-norte' },
          ],
        },
      ];
    });

    it('«Nave Global» o «Todas las naves» no son el acceso de toda la organización; las frases que sí lo dicen, en es/en/fr, sí', async () => {
      for (const dicho of [
        'Nave Global',
        'Todas las naves',
        'empresa de limpieza',
        'globalmente',
      ]) {
        expect(
          await prepError('remove_user_access', { usuario: 'Pedro', acceso: dicho })
        ).toContain('No encuentro el acceso');
      }
      for (const dicho of [
        'organización',
        'la organización',
        'toda la organización',
        'Empresa',
        'the whole organization',
        'organisation',
        "toute l'organisation",
        "l'entreprise",
        'global',
      ]) {
        expect(
          await prepared('remove_user_access', { usuario: 'Pedro', acceso: dicho })
        ).toMatchObject({ rol_id: 'r-pedro-org' });
      }
    });

    it('una ubicación que se llama como «la organización» gana: el nombre de la ubicación va primero', async () => {
      pt.locations = [...pt.locations, { id: 'loc-global', name: 'Global', address: 'x' }];
      pt.orgUsers[1].roles.push({
        id: 'r-pedro-global',
        rol: 'VIEWER',
        ambito: 'LOCATION',
        scopeId: 'loc-global',
      });
      expect(
        await prepared('remove_user_access', { usuario: 'Pedro', acceso: 'global' })
      ).toMatchObject({ rol_id: 'r-pedro-global' });
    });

    it('quitar uno de varios accesos: el resumen no promete que conserva los demás (en el lote pueden irse todos)', async () => {
      const d = action('remove_user_access');
      const p = await prepared('remove_user_access', { usuario: 'Pedro', acceso: '1' });
      const es = d.resumen(p, { idioma: 'es', organizacion: 'Empresa Demo' });
      expect(es).not.toContain('Sigue entrando');
      expect(es).toContain(
        'Conserva sus otros accesos en Empresa Demo, salvo que también se los quites en esta misma confirmación.'
      );
      expect(d.resumen(p, { idioma: 'en', organizacion: 'Empresa Demo' })).toContain(
        'They keep their other access in Empresa Demo, unless you also remove it in this same confirmation.'
      );
      expect(d.resumen(p, { idioma: 'fr', organizacion: 'Empresa Demo' })).toContain(
        'Cette personne conserve ses autres accès dans Empresa Demo, sauf si vous les lui retirez aussi dans cette même confirmation.'
      );
    });

    it('ejecutar sin usuario_id (no pasó por preparar) no se salta la protección de uno mismo: falla sin escribir', async () => {
      const p = { usuario: 'Pedro Gil', rol_id: 'r-pedro-org', rol_actual: 'VIEWER' };
      await expect(action('remove_user_access').ejecutar(execCtx(), p)).rejects.toThrow(
        'sin usuario_id'
      );
      expect(pt.writes).toEqual([]);
    });
  });
});
