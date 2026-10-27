import { describe, it, expect, beforeEach } from 'vitest';
import { actionCatalog } from './index.js';
import type { ActionContext, ActionDefinition, ActionPrepareContext } from './types.js';
import { BOT_ACTIONS } from './names.js';
import { PatrolTechApiError } from '../domain/backend-errors.js';
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
  pt.planUsage = {
    ...pt.planUsage,
    uso: { ...pt.planUsage.uso!, checkpoints: { usados: 3, incluidos: 5, extraFacturados: 0 } },
  };
  catalog = actionCatalog({ gateway: pt });
});

describe('catálogo: incidencias, vigilantes y checkpoints', () => {
  it('añade las cuatro acciones tras las de rutas, con su flag en BOT_ACTIONS', () => {
    expect(
      catalog.slice(8, 12).map((d) => [d.nombre, d.tool, d.rolMinimo, d.rolDeOrganizacion ?? false])
    ).toEqual([
      ['incident_update', 'proponer_actualizar_incidencia', 'EDITOR', false],
      ['rename_patroller', 'proponer_editar_vigilante', 'EDITOR', true],
      ['edit_checkpoint', 'proponer_editar_checkpoint', 'EDITOR', false],
      ['archive_checkpoint', 'proponer_archivar_checkpoint', 'EDITOR', false],
    ]);
    expect(BOT_ACTIONS).toEqual(
      expect.arrayContaining([
        'incident_update',
        'rename_patroller',
        'edit_checkpoint',
        'archive_checkpoint',
      ])
    );
  });
});

describe('incident_update', () => {
  it('preparar: resuelve por título, guarda id, ubicación y estado actual; «yo» se asigna al ejecutar', async () => {
    const p = await prepared('incident_update', {
      incidencia: 'puerta',
      estado: 'en_progreso',
      asignar_a: 'yo',
    });
    expect(p).toMatchObject({
      incidencia: 'Puerta del almacén forzada',
      incidencia_id: 'inc-1',
      ubicacion_id: 'loc-central',
      estado_actual: 'abierto',
      asignar_a_id: '@yo',
    });
  });

  it('preparar: también por id; resuelve el usuario por nombre o email', async () => {
    const p = await prepared('incident_update', {
      incidencia: 'inc-2',
      asignar_a: 'pedro@acme.test',
    });
    expect(p).toMatchObject({
      incidencia: 'Luz fundida en recepción',
      asignar_a: 'Pedro Gil',
      asignar_a_id: 'u-pedro',
    });
  });

  it('preparar: sin nada que cambiar, o con una incidencia que no existe, pregunta', async () => {
    expect(await prepError('incident_update', { incidencia: 'puerta' })).toContain(
      'Falta qué cambiar'
    );
    const error = await prepError('incident_update', { incidencia: 'ventana', comentario: 'x' });
    expect(error).toContain('No encuentro la incidencia «ventana»');
    expect(error).toContain('«Puerta del almacén forzada»');
  });

  it('preparar: una incidencia Cerrada o Descartada es definitiva', async () => {
    expect(await prepError('incident_update', { incidencia: 'cámara', comentario: 'x' })).toContain(
      'DEFINITIVO'
    );
  });

  it('preparar: transición no permitida, comentario obligatorio y asignación obligatoria', async () => {
    expect(
      await prepError('incident_update', {
        incidencia: 'puerta',
        estado: 'resuelto',
        comentario: 'x',
      })
    ).toBe(
      'Desde Abierto no se puede pasar a Resuelto. Desde Abierto solo se puede pasar a: En progreso, Descartado.'
    );
    expect(
      await prepError('incident_update', { incidencia: 'puerta', estado: 'descartado' })
    ).toContain('hace falta un comentario');
    expect(await prepError('incident_update', { incidencia: 'luz', estado: 'resuelto' })).toContain(
      'hace falta un comentario'
    );
    expect(
      await prepError('incident_update', { incidencia: 'puerta', estado: 'en_progreso' })
    ).toContain('tiene que estar asignada');
    expect(
      await prepError('incident_update', { incidencia: 'luz', estado: 'en_progreso' })
    ).toContain('ya está En progreso');
  });

  it('preparar: con la App de Incidencias apagada, error claro', async () => {
    pt.incidentsError = new PatrolTechApiError(403, '/api/features/incident-reporting/incidents', {
      success: false,
      message: "Feature 'incident-reporting' is not enabled for this organization",
    });
    expect(await prepError('incident_update', { incidencia: 'puerta', comentario: 'x' })).toContain(
      'La App de Incidencias no está activa en «Empresa Demo»'
    );
  });

  it('preparar: asignar a otra persona sin ser Admin (403 en usuarios) → que se la asigne él', async () => {
    pt.orgUsersError = new PatrolTechApiError(403, '/api/organizations/users', {
      message: 'Insufficient permissions',
    });
    expect(
      await prepError('incident_update', { incidencia: 'puerta', asignar_a: 'Marta' })
    ).toContain('Solo un Admin puede ver los usuarios');
  });

  it('ejecutar: asigna ANTES de cambiar el estado (En progreso lo exige), con la ubicación de la incidencia', async () => {
    const p = await prepared('incident_update', {
      incidencia: 'puerta',
      estado: 'en_progreso',
      asignar_a: 'yo',
    });
    const r = await action('incident_update').ejecutar(execCtx(), p);
    const target = { incidentId: 'inc-1', organizationId: 'org-1', locationId: 'loc-central' };
    expect(pt.writes).toEqual([
      { op: 'assignIncident', input: { ...target, userId: 'u-yo' }, token: 'jwt' },
      { op: 'updateIncidentStatus', input: { ...target, estado: 'IN_PROGRESS' }, token: 'jwt' },
    ]);
    expect(r.texto).toBe(
      '✅ Incidencia «Puerta del almacén forzada» actualizada en Empresa Demo: asignada a Ana García; estado «En progreso».'
    );
  });

  it('ejecutar: el comentario va con el cambio de estado; sin estado, como comentario suelto', async () => {
    const conEstado = await prepared('incident_update', {
      incidencia: 'luz',
      estado: 'resuelto',
      comentario: 'Cambiada la bombilla',
    });
    await action('incident_update').ejecutar(execCtx(), conEstado);
    const suelto = await prepared('incident_update', {
      incidencia: 'luz',
      comentario: 'Mañana la cambian',
    });
    const r = await action('incident_update').ejecutar(execCtx('en'), suelto);
    const target = { incidentId: 'inc-2', organizationId: 'org-1', locationId: 'loc-norte' };
    expect(pt.writes).toEqual([
      {
        op: 'updateIncidentStatus',
        input: { ...target, estado: 'RESOLVED', comentario: 'Cambiada la bombilla' },
        token: 'jwt',
      },
      {
        op: 'commentIncident',
        input: { ...target, comentario: 'Mañana la cambian' },
        token: 'jwt',
      },
    ]);
    expect(r.texto).toBe(
      '✅ Incident «Luz fundida en recepción» updated in Empresa Demo: comment added.'
    );
  });

  it('ejecutar: si falla el estado tras asignar, dice lo que sí se hizo (no «ningún cambio»)', async () => {
    const p = await prepared('incident_update', {
      incidencia: 'puerta',
      estado: 'en_progreso',
      asignar_a: 'Marta',
    });
    // La asignación sale bien; el cambio de estado, no.
    pt.updateIncidentStatus = async () => {
      throw new PatrolTechApiError(422, '/status', {
        message: 'Incident must be assigned before moving to In Progress',
      });
    };
    const r = await action('incident_update').ejecutar(execCtx(), p);
    expect(pt.writes.map((w) => w.op)).toEqual(['assignIncident']);
    expect(r.texto).toContain('✅ Incidencia «Puerta del almacén forzada»: asignada a Marta Ruiz.');
    expect(r.texto).toContain('⚠️ Pero el cambio de estado no se ha podido hacer');
  });

  it('ejecutar: sin asignación previa, un error del backend se relanza (el motor dice que no se hizo nada)', async () => {
    const p = await prepared('incident_update', { incidencia: 'puerta', comentario: 'x' });
    const err = new PatrolTechApiError(403, '/comments', {
      message: 'Incident is closed and cannot be modified',
    });
    pt.writeErrors = [err];
    await expect(action('incident_update').ejecutar(execCtx(), p)).rejects.toBe(err);
  });

  it('resumen es/en; Cerrado y Descartado avisan en MAYÚSCULAS de que es definitivo', async () => {
    const d = action('incident_update');
    const progreso = await prepared('incident_update', {
      incidencia: 'puerta',
      estado: 'en_progreso',
      asignar_a: 'Marta',
    });
    expect(d.resumen(progreso, es)).toBe(
      'En la incidencia «Puerta del almacén forzada» de Empresa Demo: cambiar su estado de «Abierto» a «En progreso»; asignarla a Marta Ruiz.'
    );
    const descartar = await prepared('incident_update', {
      incidencia: 'puerta',
      estado: 'descartado',
      comentario: 'Falsa alarma',
    });
    expect(d.resumen(descartar, es)).toBe(
      'En la incidencia «Puerta del almacén forzada» de Empresa Demo: cambiar su estado de «Abierto» a «Descartado» con el comentario «Falsa alarma».\n' +
        '⚠️ «DESCARTADO» ES DEFINITIVO: DESPUÉS LA INCIDENCIA NO SE PODRÁ REABRIR NI MODIFICAR.'
    );
    pt.incidents[1] = { ...pt.incidents[1], estado: 'RESOLVED' };
    const cerrar = await prepared('incident_update', {
      incidencia: 'luz',
      estado: 'cerrado',
      asignar_a: 'yo',
    });
    expect(d.resumen(cerrar, en)).toBe(
      'In the incident «Luz fundida en recepción» of Empresa Demo: change its status from «Resolved» to «Closed»; assign it to you.\n' +
        '⚠️ «CLOSED» IS FINAL: THE INCIDENT CANNOT BE REOPENED OR CHANGED AFTERWARDS.'
    );
  });
});

describe('rename_patroller', () => {
  it('preparar: resuelve el vigilante (por nombre o identificador) y exige algo que cambiar', async () => {
    expect(
      await prepared('rename_patroller', { vigilante: 'juan', nombre: 'Juan Pérez Gil' })
    ).toMatchObject({ vigilante: 'Juan Pérez', vigilante_id: 'p-juan' });
    expect(
      await prepared('rename_patroller', { vigilante: 'E5F6A7B8', telefono: '+34600' })
    ).toMatchObject({ vigilante_id: 'p-ana' });
    expect(await prepError('rename_patroller', { vigilante: 'juan' })).toContain(
      'Falta qué cambiar'
    );
    expect(await prepError('rename_patroller', { vigilante: 'Pedro', nombre: 'X' })).toContain(
      'No encuentro el vigilante «Pedro»'
    );
  });

  it('ejecutar: PUT solo con lo que cambia', async () => {
    const r = await action('rename_patroller').ejecutar(execCtx(), {
      vigilante: 'Juan Pérez',
      vigilante_id: 'p-juan',
      nombre: 'Juan P. Gil',
    });
    expect(pt.writes).toEqual([
      { op: 'updatePatroller', input: { id: 'p-juan', name: 'Juan P. Gil' }, token: 'jwt' },
    ]);
    expect(r.texto).toBe(
      '✅ Vigilante actualizado en Empresa Demo: «Juan P. Gil». Su enlace de la app sigue siendo el mismo.'
    );
  });

  it('resumen es/en', () => {
    const d = action('rename_patroller');
    expect(d.resumen({ vigilante: 'Juan Pérez', nombre: 'Juan P.', telefono: '+34600' }, es)).toBe(
      'Cambiar el vigilante «Juan Pérez» de Empresa Demo: nombre → «Juan P.»; teléfono → +34600. Su enlace de la app no cambia.'
    );
    expect(d.resumen({ vigilante: 'Juan Pérez', telefono: '+34600' }, en)).toBe(
      'Change the guard «Juan Pérez» of Empresa Demo: phone → +34600. Their app link stays the same.'
    );
  });
});

describe('edit_checkpoint', () => {
  it('preparar: resuelve con la ubicación y no admite código ni método (parámetros inexistentes)', async () => {
    expect(
      await prepared('edit_checkpoint', { checkpoint: 'entrada', nombre: 'Entrada norte' })
    ).toMatchObject({
      checkpoint: 'Entrada principal',
      ubicacion: 'Sede Central',
      checkpoint_id: 'cp-entrada',
    });
    expect(Object.keys(action('edit_checkpoint').params)).toEqual([
      'checkpoint',
      'ubicacion',
      'nombre',
      'descripcion',
      'checkpoint_id',
    ]);
  });

  it('preparar: mismo nombre en dos ubicaciones → pregunta con la ubicación', async () => {
    pt.checkpointRefs.push({
      id: 'cp-e2',
      name: 'Entrada principal',
      locationId: 'loc-norte',
      locationName: 'Sucursal Norte',
      metodo: 'qr_static',
      codigo: null,
    });
    const error = await prepError('edit_checkpoint', {
      checkpoint: 'Entrada principal',
      nombre: 'X',
    });
    expect(error).toContain(
      '«Entrada principal (Sede Central)», «Entrada principal (Sucursal Norte)»'
    );
    expect(
      await prepared('edit_checkpoint', {
        checkpoint: 'Entrada principal',
        ubicacion: 'norte',
        nombre: 'X',
      })
    ).toMatchObject({ checkpoint_id: 'cp-e2' });
  });

  it('ejecutar: PUT solo con nombre y descripción', async () => {
    const r = await action('edit_checkpoint').ejecutar(execCtx(), {
      checkpoint: 'Entrada principal',
      ubicacion: 'Sede Central',
      checkpoint_id: 'cp-entrada',
      descripcion: 'Junto a la garita',
    });
    expect(pt.writes).toEqual([
      {
        op: 'updateCheckpoint',
        input: { id: 'cp-entrada', description: 'Junto a la garita' },
        token: 'jwt',
      },
    ]);
    expect(r.texto).toBe(
      '✅ Checkpoint «Entrada principal» actualizado en la ubicación «Sede Central» de Empresa Demo.'
    );
  });

  it('resumen es/en: el código y el método no cambian', () => {
    const d = action('edit_checkpoint');
    const p = {
      checkpoint: 'Entrada principal',
      ubicacion: 'Sede Central',
      nombre: 'Entrada norte',
    };
    expect(d.resumen(p, es)).toBe(
      'Cambiar el checkpoint «Entrada principal» de la ubicación «Sede Central» de Empresa Demo: nombre → «Entrada norte». Su código y su método de verificación no cambian (el QR impreso sigue valiendo).'
    );
    expect(d.resumen(p, en)).toBe(
      'Change the checkpoint «Entrada principal» in the location «Sede Central» of Empresa Demo: name → «Entrada norte». Its code and verification method stay the same (the printed QR still works).'
    );
  });
});

describe('archive_checkpoint', () => {
  it('preparar archivar: busca entre los activos', async () => {
    expect(
      await prepared('archive_checkpoint', { checkpoint: 'almacén', archivar: true })
    ).toMatchObject({ checkpoint_id: 'cp-almacen', ubicacion: 'Sede Central' });
    expect(
      await prepError('archive_checkpoint', { checkpoint: 'garaje', archivar: true })
    ).toContain('No encuentro el checkpoint «garaje»');
  });

  it('preparar desarchivar: busca entre los archivados y comprueba el plan', async () => {
    expect(
      await prepared('archive_checkpoint', { checkpoint: 'garaje', archivar: false })
    ).toMatchObject({ checkpoint_id: 'cp-viejo' });
    expect(
      await prepError('archive_checkpoint', { checkpoint: 'almacén', archivar: false })
    ).toContain('Entre los checkpoints ARCHIVADOS');
  });

  it('preparar desarchivar en el límite del plan: no propone y manda a Licencia (nunca cobra)', async () => {
    pt.planUsage = {
      ...pt.planUsage,
      uso: { ...pt.planUsage.uso!, checkpoints: { usados: 5, incluidos: 5, extraFacturados: 0 } },
    };
    const error = await prepError('archive_checkpoint', { checkpoint: 'garaje', archivar: false });
    expect(error).toContain('límite de checkpoints de su plan Free (5 de 5)');
    expect(error).toContain('https://dashboard.patroltech.online/license');
  });

  it('ejecutar: archive / unarchive con el id resuelto', async () => {
    const base = { checkpoint: 'Garaje', ubicacion: 'Sede Central', checkpoint_id: 'cp-viejo' };
    await action('archive_checkpoint').ejecutar(execCtx(), { ...base, archivar: true });
    const r = await action('archive_checkpoint').ejecutar(execCtx('en'), {
      ...base,
      archivar: false,
    });
    expect(pt.writes).toEqual([
      { op: 'archiveCheckpoint', input: { id: 'cp-viejo' }, token: 'jwt' },
      { op: 'unarchiveCheckpoint', input: { id: 'cp-viejo' }, token: 'jwt' },
    ]);
    expect(r.texto).toBe(
      '✅ Checkpoint «Garaje» unarchived in the location «Sede Central» of Empresa Demo.'
    );
  });

  it('ejecutar desarchivar: el 409 del extra del backend se relanza (el motor lo deriva al panel)', async () => {
    const extra = new PatrolTechApiError(409, '/unarchive', {
      code: 'EXTRA_CHECKPOINT_CONFIRMATION_REQUIRED',
    });
    pt.writeErrors = [extra];
    await expect(
      action('archive_checkpoint').ejecutar(execCtx(), {
        checkpoint: 'Garaje',
        ubicacion: 'Sede Central',
        checkpoint_id: 'cp-viejo',
        archivar: false,
      })
    ).rejects.toBe(extra);
  });

  it('resumen: archivar avisa del QR, de que sale de sus rutas y de que desarchivar no lo devuelve a ellas', () => {
    const d = action('archive_checkpoint');
    const p = { checkpoint: 'Garaje', ubicacion: 'Sede Central' };
    expect(d.resumen({ ...p, archivar: true }, es)).toBe(
      'Archivar el checkpoint «Garaje» de la ubicación «Sede Central» de Empresa Demo.\n' +
        '⚠️ Su QR o código dejará de valer: los escaneos nuevos de ese punto se rechazarán. Sus escaneos anteriores se conservan y deja de contar para tu plan. Se quitará de todas las rutas en las que esté y se cancelarán las rondas en curso de esas rutas; si alguna se queda sin checkpoints, se desactivará. Se puede desarchivar después, pero habrá que volver a añadirlo a las rutas.'
    );
    // Sin poder leer las rutas, el aviso genérico también dice que la que se quede vacía se desactiva (es/en/fr).
    expect(d.resumen({ ...p, archivar: true }, en)).toContain(
      '; if any is left without checkpoints, it will be deactivated.'
    );
    expect(
      d.resumen({ ...p, archivar: true }, { idioma: 'fr', organizacion: 'Empresa Demo' })
    ).toContain("; si l'un d'eux reste sans checkpoints, il sera désactivé.");
    expect(d.resumen({ ...p, archivar: false }, en)).toBe(
      'Unarchive the checkpoint «Garaje» in the location «Sede Central» of Empresa Demo: it accepts scans again and counts towards your plan again. It does not go back to the routes it was on: it has to be added again.'
    );
  });
});

describe('archive_checkpoint: las rutas de las que sale', () => {
  const p = { checkpoint: 'Entrada principal', ubicacion: 'Sede Central', archivar: true };
  const ruta = (id: string, name: string, isActive: boolean, checkpointIds: string[]) => ({
    id,
    name,
    isActive,
    locationId: 'loc-central',
    checkpoints: checkpointIds.map((checkpointId, i) => ({ checkpointId, order: i + 1 })),
    timeWindows: [],
  });
  // Toda ruta de la lista tiene detalle: una sin él es «no se sabe» (aviso genérico).
  beforeEach(() => {
    pt.routeDetails['r-sur'] = ruta('r-sur', 'Ruta Sur', false, ['cp-recepcion']);
  });

  it('preparar: guarda en qué rutas está, cuáles se quedan vacías y si están activas', async () => {
    pt.routeDetails['r-sur'] = ruta('r-sur', 'Ruta Sur', false, ['cp-almacen', 'cp-entrada']);
    expect(
      (await prepared('archive_checkpoint', { checkpoint: 'entrada', archivar: true })).rutas
    ).toEqual([
      { id: 'r-norte', name: 'Ruta Norte', leftEmpty: true, deactivated: true },
      { id: 'r-sur', name: 'Ruta Sur', leftEmpty: false, deactivated: false },
    ]);
    expect(
      (await prepared('archive_checkpoint', { checkpoint: 'almacén', archivar: true })).rutas
    ).toEqual([{ id: 'r-sur', name: 'Ruta Sur', leftEmpty: false, deactivated: false }]);
  });

  it('preparar: un checkpoint repetido como único de la ruta la deja vacía igual', async () => {
    pt.routeDetails['r-norte'] = ruta('r-norte', 'Ruta Norte', true, ['cp-entrada', 'cp-entrada']);
    expect(
      (await prepared('archive_checkpoint', { checkpoint: 'entrada', archivar: true })).rutas
    ).toEqual([{ id: 'r-norte', name: 'Ruta Norte', leftEmpty: true, deactivated: true }]);
  });

  it('preparar: en ninguna ruta → lista vacía; con la lista de rutas truncada o sin poder leerla, no se arriesga', async () => {
    expect(
      (await prepared('archive_checkpoint', { checkpoint: 'almacén', archivar: true })).rutas
    ).toEqual([]);
    pt.truncado = true;
    expect(
      (await prepared('archive_checkpoint', { checkpoint: 'almacén', archivar: true })).rutas
    ).toBeUndefined();
    pt.truncado = false;
    pt.getRouteDetails = async () => {
      throw new Error('caído');
    };
    expect(
      (await prepared('archive_checkpoint', { checkpoint: 'almacén', archivar: true })).rutas
    ).toBeUndefined();
  });

  it('preparar desarchivar no busca rutas', async () => {
    expect(
      (await prepared('archive_checkpoint', { checkpoint: 'garaje', archivar: false })).rutas
    ).toBeUndefined();
  });

  it('resumen: nombra las rutas y avisa de las que se desactivan, en es/en/fr', () => {
    const d = action('archive_checkpoint');
    const rutas = [
      { id: 'r-norte', name: 'Ruta Norte', leftEmpty: true, deactivated: true },
      { id: 'r-sur', name: 'Ruta Sur', leftEmpty: false, deactivated: false },
      { id: 'r-vieja', name: 'Ruta Vieja', leftEmpty: true, deactivated: false },
    ];
    expect(d.resumen({ ...p, rutas }, es)).toBe(
      'Archivar el checkpoint «Entrada principal» de la ubicación «Sede Central» de Empresa Demo.\n' +
        '⚠️ Su QR o código dejará de valer: los escaneos nuevos de ese punto se rechazarán. Sus escaneos anteriores se conservan y deja de contar para tu plan. ' +
        'Se quitará de las rutas «Ruta Norte», «Ruta Sur», «Ruta Vieja» y se cancelarán sus rondas en curso. ' +
        'Se puede desarchivar después, pero habrá que volver a añadirlo a las rutas.\n' +
        '⚠️ La ruta «Ruta Norte» se quedará sin checkpoints y se desactivará: no generará rondas hasta que le añadas checkpoints y la vuelvas a activar.'
    );
    expect(d.resumen({ ...p, rutas }, en)).toBe(
      'Archive the checkpoint «Entrada principal» in the location «Sede Central» of Empresa Demo.\n' +
        '⚠️ Its QR or code will stop working: new scans of that point will be rejected. Its past scans are kept and it no longer counts towards your plan. ' +
        'It will be removed from the routes «Ruta Norte», «Ruta Sur», «Ruta Vieja» and their rounds in progress will be cancelled. ' +
        'You can unarchive it later, but it will have to be added to the routes again.\n' +
        "⚠️ The route «Ruta Norte» will be left without checkpoints and deactivated: it won't generate rounds until you add checkpoints and activate it again."
    );
    expect(d.resumen({ ...p, rutas }, { idioma: 'fr', organizacion: 'Empresa Demo' })).toBe(
      'Archiver le checkpoint «Entrada principal» du site «Sede Central» de Empresa Demo.\n' +
        '⚠️ Son QR code ou son code ne fonctionnera plus : les nouveaux scans de ce point seront refusés. Ses scans précédents sont conservés et il ne compte plus dans votre forfait. ' +
        'Il sera retiré des parcours «Ruta Norte», «Ruta Sur», «Ruta Vieja» et leurs rondes en cours seront annulées. ' +
        'Vous pourrez le désarchiver plus tard, mais il faudra le rajouter aux parcours.\n' +
        "⚠️ Le parcours «Ruta Norte» restera sans checkpoints et sera désactivé : il ne générera plus de rondes tant que vous n'y ajouterez pas de checkpoints et ne le réactiverez pas."
    );
  });

  it('resumen: si no está en ninguna ruta lo dice', () => {
    expect(action('archive_checkpoint').resumen({ ...p, rutas: [] }, es)).toBe(
      'Archivar el checkpoint «Entrada principal» de la ubicación «Sede Central» de Empresa Demo.\n' +
        '⚠️ Su QR o código dejará de valer: los escaneos nuevos de ese punto se rechazarán. Sus escaneos anteriores se conservan y deja de contar para tu plan. ' +
        'No está en ninguna ruta. Se puede desarchivar después.'
    );
  });

  it('ejecutar: con las rutas que devuelve el backend dice de cuáles ha salido y cuáles se han desactivado', async () => {
    pt.archiveResult = [
      { id: 'r-norte', name: 'Ruta Norte', leftEmpty: true, deactivated: true },
      { id: 'r-sur', name: 'Ruta Sur', leftEmpty: false, deactivated: false },
    ];
    const ejecutar = (idioma: FixedTextLanguage) =>
      action('archive_checkpoint').ejecutar(execCtx(idioma), { ...p, checkpoint_id: 'cp-entrada' });
    expect((await ejecutar('es')).texto).toBe(
      '✅ Checkpoint «Entrada principal» archivado en la ubicación «Sede Central» de Empresa Demo.\n' +
        'Se ha quitado de las rutas «Ruta Norte», «Ruta Sur».\n' +
        'Desactivadas por quedarse sin checkpoints: «Ruta Norte».'
    );
    expect((await ejecutar('en')).texto).toBe(
      '✅ Checkpoint «Entrada principal» archived in the location «Sede Central» of Empresa Demo.\n' +
        'Removed from the routes «Ruta Norte», «Ruta Sur».\n' +
        'Deactivated for having no checkpoints left: «Ruta Norte».'
    );
    expect((await ejecutar('fr')).texto).toBe(
      '✅ Checkpoint «Entrada principal» archivé sur le site «Sede Central» de Empresa Demo.\n' +
        'Retiré des parcours «Ruta Norte», «Ruta Sur».\n' +
        'Désactivés faute de checkpoints : «Ruta Norte».'
    );
  });

  it('ejecutar: sin rutas afectadas, o con un backend que no las devuelve, solo el ✅', async () => {
    const ejecutar = () =>
      action('archive_checkpoint').ejecutar(execCtx(), { ...p, checkpoint_id: 'cp-entrada' });
    pt.archiveResult = [];
    expect((await ejecutar()).texto).toBe(
      '✅ Checkpoint «Entrada principal» archivado en la ubicación «Sede Central» de Empresa Demo.'
    );
    pt.archiveResult = null;
    expect((await ejecutar()).texto).toBe(
      '✅ Checkpoint «Entrada principal» archivado en la ubicación «Sede Central» de Empresa Demo.'
    );
  });
});

describe('textos de incidencias, vigilantes y checkpoints en francés', () => {
  it('incident_update: resumen y estados en francés, con el aviso de definitivo', async () => {
    pt.incidents[1] = { ...pt.incidents[1], estado: 'RESOLVED' };
    const cerrar = await prepared('incident_update', {
      incidencia: 'luz',
      estado: 'cerrado',
      asignar_a: 'yo',
    });
    expect(
      action('incident_update').resumen(cerrar, { idioma: 'fr', organizacion: 'Empresa Demo' })
    ).toBe(
      "Dans l'incident «Luz fundida en recepción» de Empresa Demo : passer son statut de «Résolu» à «Clôturé»; vous l'assigner.\n" +
        "⚠️ «CLÔTURÉ» EST DÉFINITIF : L'INCIDENT NE POURRA PLUS ÊTRE ROUVERT NI MODIFIÉ."
    );
  });

  it('archive_checkpoint: el resultado en francés', async () => {
    const p = {
      checkpoint: 'Garaje',
      ubicacion: 'Sede Central',
      archivar: true,
      checkpoint_id: 'cp-garaje',
    };
    const r = await action('archive_checkpoint').ejecutar(execCtx('fr'), p);
    expect(r.texto).toBe(
      '✅ Checkpoint «Garaje» archivé sur le site «Sede Central» de Empresa Demo.'
    );
  });
});
