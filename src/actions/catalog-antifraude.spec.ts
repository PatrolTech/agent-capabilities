import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { actionCatalog } from './index.js';
import type { ActionContext, ActionDefinition, ActionPrepareContext } from './types.js';
import { AccionRechazada, BOT_ACTIONS } from './names.js';
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
const ctxResumen = (idioma: FixedTextLanguage) => ({ idioma, organizacion: 'Empresa Demo' });

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
const valida = (nombre: string, params: Record<string, unknown>) =>
  z.object(action(nombre).params).safeParse(params).success;

beforeEach(() => {
  pt = new FakePatrolTechGateway();
  pt.checkpointGeo['cp-entrada'] = {
    latitud: 40.4,
    longitud: -3.7,
    reglasAntifraude: {
      gpsProximity: { maxDistanceMeters: 30, maxAccuracyMeters: 50 },
      undergroundMode: { enabled: true },
    },
  };
  catalog = actionCatalog({ gateway: pt });
});

describe('catálogo: antifraude y posición del checkpoint', () => {
  it('las dos acciones van tras las de rutas y checkpoints, son de EDITOR (también de ubicación) y están en BOT_ACTIONS', () => {
    const i = catalog.findIndex((d) => d.nombre === 'archive_checkpoint');
    expect(
      catalog
        .slice(i + 1, i + 3)
        .map((d) => [d.nombre, d.tool, d.rolMinimo, d.rolDeOrganizacion ?? false])
    ).toEqual([
      ['edit_checkpoint_antifraud', 'proponer_cambiar_antifraude', 'EDITOR', false],
      ['move_checkpoint', 'proponer_mover_checkpoint', 'EDITOR', false],
    ]);
    expect(BOT_ACTIONS).toEqual(
      expect.arrayContaining(['edit_checkpoint_antifraud', 'move_checkpoint'])
    );
  });
});

describe('edit_checkpoint_antifraud', () => {
  it('preparar: resuelve el checkpoint de la organización y guarda las reglas de antes y de después', async () => {
    const p = await prepared('edit_checkpoint_antifraud', {
      checkpoint: 'entrada',
      distancia_maxima_m: 100,
      modo_subterraneo: false,
    });
    expect(p).toMatchObject({
      checkpoint: 'Entrada principal',
      ubicacion: 'Sede Central',
      checkpoint_id: 'cp-entrada',
      ubicacion_id: 'loc-central',
      reglas_antes: {
        gpsProximity: { maxDistanceMeters: 30, maxAccuracyMeters: 50 },
        undergroundMode: { enabled: true },
      },
      // La precisión que ya tenía se conserva; el modo subterráneo apagado no se guarda (como el panel).
      reglas_despues: { gpsProximity: { maxDistanceMeters: 100, maxAccuracyMeters: 50 } },
    });
  });

  it('preparar: la distancia y la precisión van acotadas; y hace falta algo que cambiar', async () => {
    expect(valida('edit_checkpoint_antifraud', { checkpoint: 'x', distancia_maxima_m: 5 })).toBe(
      false
    );
    expect(valida('edit_checkpoint_antifraud', { checkpoint: 'x', distancia_maxima_m: 5001 })).toBe(
      false
    );
    expect(valida('edit_checkpoint_antifraud', { checkpoint: 'x', precision_maxima_m: 0 })).toBe(
      false
    );
    expect(valida('edit_checkpoint_antifraud', { checkpoint: 'x', distancia_maxima_m: 10 })).toBe(
      true
    );
    expect(await prepError('edit_checkpoint_antifraud', { checkpoint: 'entrada' })).toContain(
      'Falta qué cambiar'
    );
    expect(
      await prepError('edit_checkpoint_antifraud', {
        checkpoint: 'entrada',
        distancia_maxima_m: 30,
      })
    ).toContain('ya tiene esas reglas');
    expect(
      await prepError('edit_checkpoint_antifraud', {
        checkpoint: 'entrada',
        proximidad_gps: false,
        distancia_maxima_m: 80,
      })
    ).toContain('Contradictorio');
  });

  it('preparar: activar la proximidad GPS en un punto sin coordenadas → que primero fije su posición', async () => {
    const error = await prepError('edit_checkpoint_antifraud', {
      checkpoint: 'almacén',
      proximidad_gps: true,
    });
    expect(error).toContain('no tiene posición');
    expect(error).toContain('proponer_mover_checkpoint');
    // Apagar el modo subterráneo no necesita coordenadas.
    pt.checkpointGeo['cp-almacen'] = { reglasAntifraude: { undergroundMode: { enabled: true } } };
    expect(
      await prepared('edit_checkpoint_antifraud', {
        checkpoint: 'almacén',
        modo_subterraneo: false,
      })
    ).toMatchObject({ reglas_despues: {} });
  });

  it('preparar: activar sin distancia usa 100 m (la del panel); con geocerca o con reglas desconocidas, al panel', async () => {
    pt.checkpointGeo['cp-almacen'] = { latitud: 1, longitud: 2 };
    expect(
      await prepared('edit_checkpoint_antifraud', { checkpoint: 'almacén', proximidad_gps: true })
    ).toMatchObject({
      reglas_antes: {},
      reglas_despues: { gpsProximity: { maxDistanceMeters: 100 } },
    });
    pt.checkpointRefs[1] = { ...pt.checkpointRefs[1], metodo: 'geofence' };
    expect(
      await prepError('edit_checkpoint_antifraud', { checkpoint: 'almacén', proximidad_gps: true })
    ).toContain('geocerca');
    pt.checkpointGeo['cp-entrada'].reglasDesconocidas = ['wifiCheck'];
    expect(
      await prepError('edit_checkpoint_antifraud', {
        checkpoint: 'entrada',
        modo_subterraneo: false,
      })
    ).toContain('panel');
  });

  it('ejecutar: vuelve a leer y fusiona al escribir (no pisa lo cambiado entretanto en el panel); PUT solo con fraudRules', async () => {
    const p = await prepared('edit_checkpoint_antifraud', {
      checkpoint: 'entrada',
      distancia_maxima_m: 100,
    });
    // Entre la propuesta y el «Confirmar», alguien apaga el modo subterráneo en el panel.
    pt.checkpointGeo['cp-entrada'].reglasAntifraude = {
      gpsProximity: { maxDistanceMeters: 30, maxAccuracyMeters: 50 },
    };
    const r = await action('edit_checkpoint_antifraud').ejecutar(execCtx(), p);
    expect(pt.writes).toEqual([
      {
        op: 'updateCheckpointFraudRules',
        input: {
          id: 'cp-entrada',
          fraudRules: { gpsProximity: { maxDistanceMeters: 100, maxAccuracyMeters: 50 } },
        },
        token: 'jwt',
      },
    ]);
    expect(r.texto).toBe(
      '✅ Antifraude del checkpoint «Entrada principal» actualizado en la ubicación «Sede Central» de Empresa Demo.'
    );
  });

  it('ejecutar: sin ninguna regla, se envía null (igual que el panel); si el punto ya no está, falla', async () => {
    const p = await prepared('edit_checkpoint_antifraud', {
      checkpoint: 'entrada',
      proximidad_gps: false,
      modo_subterraneo: false,
    });
    await action('edit_checkpoint_antifraud').ejecutar(execCtx(), p);
    expect(pt.writes[0].input).toEqual({ id: 'cp-entrada', fraudRules: null });
    pt.checkpointRefs = pt.checkpointRefs.filter((c) => c.id !== 'cp-entrada');
    await expect(action('edit_checkpoint_antifraud').ejecutar(execCtx(), p)).rejects.toBeInstanceOf(
      AccionRechazada
    );
  });

  it('resumen es/en/fr: antes → después de cada regla que cambia', async () => {
    const p = await prepared('edit_checkpoint_antifraud', {
      checkpoint: 'entrada',
      distancia_maxima_m: 100,
      modo_subterraneo: false,
    });
    const d = action('edit_checkpoint_antifraud');
    expect(d.resumen(p, ctxResumen('es'))).toBe(
      'Cambiar el antifraude del checkpoint «Entrada principal» de la ubicación «Sede Central» de Empresa Demo: ' +
        'proximidad GPS: máx. 30 m (precisión GPS máx. 50 m) → máx. 100 m (precisión GPS máx. 50 m); modo subterráneo: activado → desactivado. ' +
        'Afecta a los escaneos nuevos; los avisos ya enviados no cambian.'
    );
    expect(d.resumen(p, ctxResumen('en'))).toBe(
      'Change the anti-fraud settings of the checkpoint «Entrada principal» in the location «Sede Central» of Empresa Demo: ' +
        'GPS proximity: max. 30 m (GPS accuracy max. 50 m) → max. 100 m (GPS accuracy max. 50 m); underground mode: on → off. ' +
        'It applies to new scans; alerts already sent do not change.'
    );
    expect(d.resumen(p, ctxResumen('fr'))).toContain(
      'proximité GPS : max. 30 m (précision GPS max. 50 m) → max. 100 m'
    );
    expect(d.resumen(p, ctxResumen('fr'))).toContain('mode souterrain : activé → désactivé');
  });
});

describe('move_checkpoint', () => {
  it('preparar: resuelve el checkpoint y guarda la posición anterior y su proximidad GPS', async () => {
    expect(
      await prepared('move_checkpoint', { checkpoint: 'entrada', latitud: 40.43, longitud: -3.7 })
    ).toMatchObject({
      checkpoint: 'Entrada principal',
      ubicacion: 'Sede Central',
      checkpoint_id: 'cp-entrada',
      latitud_actual: 40.4,
      longitud_actual: -3.7,
      proximidad_m: 30,
    });
  });

  it('preparar: coordenadas fuera de rango, (0, 0) o la misma posición no se proponen', async () => {
    expect(valida('move_checkpoint', { checkpoint: 'x', latitud: 91, longitud: 0 })).toBe(false);
    expect(valida('move_checkpoint', { checkpoint: 'x', latitud: 0, longitud: -181 })).toBe(false);
    expect(
      await prepError('move_checkpoint', { checkpoint: 'entrada', latitud: 0, longitud: 0 })
    ).toContain('(0, 0)');
    expect(
      await prepError('move_checkpoint', { checkpoint: 'entrada', latitud: 40.4, longitud: -3.7 })
    ).toContain('ya está en esa posición');
  });

  it('resumen es/en/fr: distancia a la posición anterior, enlace de Google Maps y aviso de la proximidad GPS', async () => {
    const p = await prepared('move_checkpoint', {
      checkpoint: 'entrada',
      latitud: 40.43,
      longitud: -3.7,
    });
    const d = action('move_checkpoint');
    expect(d.resumen(p, ctxResumen('es'))).toBe(
      'Mover el checkpoint «Entrada principal» de la ubicación «Sede Central» de Empresa Demo a su nueva posición: ' +
        'https://www.google.com/maps?q=40.43,-3.7 (a 3,3 km de la anterior).\n' +
        '⚠️ Tiene activada la proximidad GPS (máx. 30 m): los escaneos se medirán desde esta nueva posición.'
    );
    expect(d.resumen(p, ctxResumen('en'))).toBe(
      'Move the checkpoint «Entrada principal» in the location «Sede Central» of Empresa Demo to its new position: ' +
        'https://www.google.com/maps?q=40.43,-3.7 (3.3 km from the previous one).\n' +
        '⚠️ GPS proximity is on (max. 30 m): scans will be measured from this new position.'
    );
    expect(d.resumen(p, ctxResumen('fr'))).toContain('(à 3,3 km de la précédente)');
  });

  it('resumen: sin posición anterior lo dice; a menos de 1 km, en metros; geocerca también avisa', async () => {
    const sinPos = await prepared('move_checkpoint', {
      checkpoint: 'almacén',
      latitud: 40.4,
      longitud: -3.7,
    });
    expect(action('move_checkpoint').resumen(sinPos, ctxResumen('es'))).toBe(
      'Mover el checkpoint «Almacén» de la ubicación «Sede Central» de Empresa Demo a su nueva posición: ' +
        'https://www.google.com/maps?q=40.4,-3.7 (no tenía posición guardada).'
    );
    pt.checkpointGeo['cp-entrada'] = { latitud: 40.4, longitud: -3.7 };
    pt.checkpointRefs[0] = { ...pt.checkpointRefs[0], metodo: 'geofence' };
    const cerca = await prepared('move_checkpoint', {
      checkpoint: 'entrada',
      latitud: 40.4005,
      longitud: -3.7,
    });
    const r = action('move_checkpoint').resumen(cerca, ctxResumen('es'));
    expect(r).toContain('(a 56 m de la anterior)');
    expect(r).toContain(
      '⚠️ Verifica por geocerca: los escaneos se comprobarán contra esta nueva posición.'
    );
  });

  it('ejecutar: PUT solo con latitud y longitud', async () => {
    const p = await prepared('move_checkpoint', {
      checkpoint: 'entrada',
      latitud: 40.43,
      longitud: -3.7,
    });
    const r = await action('move_checkpoint').ejecutar(execCtx('en'), p);
    expect(pt.writes).toEqual([
      {
        op: 'moveCheckpoint',
        input: { id: 'cp-entrada', latitude: 40.43, longitude: -3.7 },
        token: 'jwt',
      },
    ]);
    expect(r.texto).toBe(
      '✅ Checkpoint «Entrada principal» moved in the location «Sede Central» of Empresa Demo: https://www.google.com/maps?q=40.43,-3.7'
    );
  });
});
