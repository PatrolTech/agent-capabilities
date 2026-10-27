import { describe, it, expect, beforeEach } from 'vitest';
import type { z } from 'zod';
import { actionCatalog, CHECKPOINT_RECOVERY_WINDOW_MS } from './index.js';
import type { ActionContext, ActionDefinition, ActionPrepareContext } from './types.js';
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
  user: { id: 'u1', name: 'Ana García' },
});
const execCtx = (
  idioma: FixedTextLanguage = 'es',
  idempotencyKey: string | null = null
): ActionContext => ({
  ...prepCtx(idioma),
  user: { id: 'u1', name: 'Ana García' },
  idempotencyKey,
});

let pt: FakePatrolTechGateway;
let catalog: ActionDefinition[];
const action = (nombre: string): ActionDefinition => catalog.find((d) => d.nombre === nombre)!;

/** `preparar` que tiene que salir bien: devuelve sus parámetros y la clave. */
async function prepared(nombre: string, params: Record<string, unknown>) {
  const r = await action(nombre).preparar!(prepCtx(), params);
  if ('error' in r) throw new Error(`preparar falló: ${r.error}`);
  return r;
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

describe('catálogo de acciones', () => {
  it('trae las acciones con sus tools proponer_*', () => {
    expect(catalog.map((d) => [d.nombre, d.tool])).toEqual([
      ['create_checkpoint', 'proponer_crear_checkpoint'],
      ['create_patroller', 'proponer_crear_vigilante'],
      ['set_alert_preference', 'proponer_cambiar_alerta'],
      ['create_route', 'proponer_crear_ruta'],
      ['add_time_window', 'proponer_anadir_horario'],
      ['delete_time_window', 'proponer_borrar_horario'],
      ['set_route_active', 'proponer_activar_ruta'],
      ['route_checkpoint', 'proponer_cambiar_checkpoint_ruta'],
      ['incident_update', 'proponer_actualizar_incidencia'],
      ['rename_patroller', 'proponer_editar_vigilante'],
      ['edit_checkpoint', 'proponer_editar_checkpoint'],
      ['archive_checkpoint', 'proponer_archivar_checkpoint'],
      ['edit_checkpoint_antifraud', 'proponer_cambiar_antifraude'],
      ['move_checkpoint', 'proponer_mover_checkpoint'],
      ['edit_location', 'proponer_editar_ubicacion'],
      ['delete_location', 'proponer_borrar_ubicacion'],
      ['invite_user', 'proponer_invitar_usuario'],
      ['change_user_role', 'proponer_cambiar_rol_usuario'],
      ['remove_user_access', 'proponer_quitar_acceso_usuario'],
    ]);
    expect(action('create_patroller').rolDeOrganizacion).toBe(true);
    // Crear una ruta exige EDITOR de organización; el resto de rutas, EDITOR también de ubicación.
    expect(action('create_route')).toMatchObject({ rolMinimo: 'EDITOR', rolDeOrganizacion: true });
    for (const n of [
      'add_time_window',
      'delete_time_window',
      'set_route_active',
      'route_checkpoint',
    ]) {
      expect(action(n)).toMatchObject({ rolMinimo: 'EDITOR' });
      expect(action(n).rolDeOrganizacion).toBeUndefined();
    }
    expect(action('set_alert_preference').rolMinimo).toBe('VIEWER');
  });
});

describe('create_checkpoint', () => {
  it('el parámetro nombre pide un nombre corto y limpio, sin prefijos genéricos ni mayúsculas', () => {
    const descripcion = (action('create_checkpoint').params.nombre as z.ZodType).description ?? '';
    expect(descripcion).toMatch(/corto, que describa el lugar y en formato normal/);
    expect(descripcion).toMatch(
      /No todo en mayúsculas, sin prefijos genéricos como «Checkpoint 1» o «Punto 3» ni numeración/
    );
    expect(descripcion).toMatch(/propón la versión limpia/);
    expect(descripcion).toMatch(/Si insiste en su formato, respétalo/);
  });

  it('preparar: con una sola ubicación la elige sin preguntar y guarda su id', async () => {
    pt.locations = [{ id: 'loc-central', name: 'Sede Central' }];
    const r = await prepared('create_checkpoint', { nombre: 'Entrada', metodo: 'qr' });
    expect(r.params).toMatchObject({
      nombre: 'Entrada',
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
    });
  });

  it('preparar: con varias y sin decir cuál, pide elegir con la lista', async () => {
    const error = await prepError('create_checkpoint', { nombre: 'Entrada', metodo: 'qr' });
    expect(error).toContain('varias ubicaciones');
    expect(error).toContain('«Sede Central»');
    expect(error).toContain('«Sucursal Norte»');
  });

  it('preparar: una ubicación ambigua no se resuelve cogiendo la primera', async () => {
    pt.locations = [
      { id: 'a', name: 'Sede Norte' },
      { id: 'b', name: 'Sede Sur' },
    ];
    const error = await prepError('create_checkpoint', {
      nombre: 'Entrada',
      metodo: 'qr',
      ubicacion: 'Sede',
    });
    expect(error).toContain('varias ubicaciones que casan');
  });

  it('preparar: el id de ubicación que mande el modelo se ignora; manda el resuelto por nombre', async () => {
    const r = await prepared('create_checkpoint', {
      nombre: 'Entrada',
      metodo: 'qr',
      ubicacion: 'norte',
      ubicacion_id: 'inventado',
    });
    expect(r.params).toMatchObject({ ubicacion: 'Sucursal Norte', ubicacion_id: 'loc-norte' });
  });

  it('preparar: en el límite del plan no propone y manda a Licencia', async () => {
    pt.planUsage = {
      ...pt.planUsage,
      uso: { ...pt.planUsage.uso!, checkpoints: { usados: 5, incluidos: 5, extraFacturados: 0 } },
    };
    const error = await prepError('create_checkpoint', {
      nombre: 'Entrada',
      metodo: 'qr',
      ubicacion: 'Sede Central',
    });
    expect(error).toContain('límite');
    expect(error).toContain('https://dashboard.patroltech.online/license');
  });

  it('preparar: un plan sin tope de checkpoints no bloquea', async () => {
    pt.planUsage = {
      ...pt.planUsage,
      uso: {
        ...pt.planUsage.uso!,
        checkpoints: { usados: 500, incluidos: null, extraFacturados: 0 },
      },
    };
    await expect(
      prepared('create_checkpoint', { nombre: 'Entrada', metodo: 'qr', ubicacion: 'Sede Central' })
    ).resolves.toBeTruthy();
  });

  it('ejecutar QR: crea con qr_static en la ubicación resuelta y devuelve el código y la imagen', async () => {
    const r = await action('create_checkpoint').ejecutar(execCtx(), {
      nombre: 'Entrada',
      metodo: 'qr',
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
    });
    expect(pt.writes).toEqual([
      {
        op: 'createCheckpoint',
        input: { name: 'Entrada', locationId: 'loc-central', metodo: 'qr_static' },
        token: 'jwt',
      },
    ]);
    expect(r.texto).toContain(
      '✅ Checkpoint «Entrada» creado en la ubicación «Sede Central» de Empresa Demo'
    );
    expect(r.texto).toContain('PT-NEW0000001');
    expect(r.imagen?.caption).toBe('Entrada\nPT-NEW0000001');
    expect(r.imagen?.png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('ejecutar código manual: sin imagen, el código en texto', async () => {
    const r = await action('create_checkpoint').ejecutar(execCtx(), {
      nombre: 'Almacén',
      metodo: 'codigo_manual',
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
    });
    expect(pt.writes[0].input).toMatchObject({ metodo: 'manual_code' });
    expect(r.imagen).toBeUndefined();
    expect(r.texto).toContain('el vigilante teclea PT-NEW0000001');
  });

  it('ejecutar: tras un 5xx, si el checkpoint aparece recién creado con ese nombre, es un éxito', async () => {
    pt.writeErrors = [new PatrolTechApiError(503, '/api/checkpoints', null)];
    pt.existingCheckpoints = [
      {
        id: 'cp-x',
        name: 'Entrada',
        locationId: 'loc-central',
        metodo: 'qr_static',
        codigo: 'PT-RECUPERADO',
        creadoEn: new Date().toISOString(),
      },
    ];
    const r = await action('create_checkpoint').ejecutar(execCtx(), {
      nombre: 'Entrada',
      metodo: 'qr',
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
    });
    expect(r.texto).toContain('PT-RECUPERADO');
    expect(r.imagen).toBeDefined();
  });

  it('ejecutar: tras un timeout sin checkpoint reciente (o uno viejo con ese nombre), relanza el error original', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    pt.writeErrors = [timeout];
    pt.existingCheckpoints = [
      {
        id: 'cp-viejo',
        name: 'Entrada',
        locationId: 'loc-central',
        metodo: 'qr_static',
        codigo: 'PT-VIEJO',
        creadoEn: new Date(Date.now() - CHECKPOINT_RECOVERY_WINDOW_MS - 60_000).toISOString(),
      },
    ];
    await expect(
      action('create_checkpoint').ejecutar(execCtx(), {
        nombre: 'Entrada',
        metodo: 'qr',
        ubicacion: 'Sede Central',
        ubicacion_id: 'loc-central',
      })
    ).rejects.toBe(timeout);
  });

  it('ejecutar: un 4xx (p. ej. 402 de límite) no busca nada: se relanza', async () => {
    const limite = new PatrolTechApiError(402, '/api/checkpoints', {
      code: 'CHECKPOINT_LIMIT_REACHED',
    });
    pt.writeErrors = [limite];
    pt.existingCheckpoints = [
      {
        id: 'cp-x',
        name: 'Entrada',
        locationId: 'loc-central',
        metodo: 'qr_static',
        codigo: 'PT-X',
        creadoEn: new Date().toISOString(),
      },
    ];
    await expect(
      action('create_checkpoint').ejecutar(execCtx(), {
        nombre: 'Entrada',
        metodo: 'qr',
        ubicacion: 'Sede Central',
        ubicacion_id: 'loc-central',
      })
    ).rejects.toBe(limite);
  });

  it('resumen es/en repite organización, ubicación y método', () => {
    const p = {
      nombre: 'Entrada',
      metodo: 'qr',
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
    };
    expect(
      action('create_checkpoint').resumen(p, { idioma: 'es', organizacion: 'Empresa Demo' })
    ).toBe(
      'Crear el checkpoint «Entrada» en la ubicación «Sede Central» de Empresa Demo, con QR (para imprimirlo y pegarlo en el punto). El código lo genera el panel.'
    );
    expect(
      action('create_checkpoint').resumen(
        { ...p, metodo: 'codigo_manual' },
        { idioma: 'en', organizacion: 'Empresa Demo' }
      )
    ).toBe(
      'Create the checkpoint «Entrada» in the location «Sede Central» of Empresa Demo, with a manual code. The dashboard generates the code.'
    );
  });
});

describe('create_patroller', () => {
  it('preparar: genera el identificador (8 hex) y lo usa como clave idempotente', async () => {
    const r = await prepared('create_patroller', { nombre: 'Luis' });
    expect(r.params.identificador).toMatch(/^[0-9A-F]{8}$/);
    expect(r.idempotencyKey).toBe(r.params.identificador);
  });

  it('ejecutar: crea con ese identificador y devuelve su enlace personal, el QR del enlace y el aviso', async () => {
    const r = await action('create_patroller').ejecutar(execCtx('es', 'ABCDEF12'), {
      nombre: 'Luis',
      telefono: '+34600111222',
      identificador: 'ABCDEF12',
    });
    expect(pt.writes).toEqual([
      {
        op: 'createPatroller',
        input: {
          organizationId: 'org-1',
          name: 'Luis',
          identifier: 'ABCDEF12',
          phone: '+34600111222',
        },
        token: 'jwt',
      },
    ]);
    expect(r.texto).toContain('https://app.patroltech.online/org-1/ABCDEF12');
    expect(r.texto).toContain('solo a esa persona, nunca a un grupo');
    // Mensaje listo para reenviar al vigilante, con SU enlace y cómo instalar la app.
    expect(r.texto).toContain(
      'Mensaje listo para reenviar a Luis por WhatsApp o email:\n\nHola Luis, te paso tu acceso a PatrolTech'
    );
    expect(r.texto).toContain(
      'Tu enlace personal (no lo compartas): https://app.patroltech.online/org-1/ABCDEF12'
    );
    expect(r.texto).toContain('instala «Patrol Tech Scan» desde Google Play');
    expect(r.imagen?.caption).toBe('Luis\nhttps://app.patroltech.online/org-1/ABCDEF12');
  });

  it('ejecutar: si el alta falla (duplicado → 500) pero el vigilante existe con ese identificador, es un éxito', async () => {
    pt.writeErrors = [new PatrolTechApiError(500, '/api/patrollers', null)];
    pt.existingPatrollers = [
      { id: 'p-9', name: 'Luis', identifier: 'ABCDEF12', organizationId: 'org-1' },
    ];
    const r = await action('create_patroller').ejecutar(execCtx('en', 'ABCDEF12'), {
      nombre: 'Luis',
      identificador: 'ABCDEF12',
    });
    expect(r.texto).toContain('✅ Guard «Luis» created in Empresa Demo');
    expect(r.texto).toContain('https://app.patroltech.online/org-1/ABCDEF12');
  });

  it('ejecutar en inglés: el mensaje para reenviar también va en inglés', async () => {
    const r = await action('create_patroller').ejecutar(execCtx('en', 'ABCDEF12'), {
      nombre: 'Luis',
      identificador: 'ABCDEF12',
    });
    expect(r.texto).toContain('never to a group');
    expect(r.texto).toContain('Message ready to forward to Luis by WhatsApp or email:\n\nHi Luis,');
    expect(r.texto).toContain(
      "Your personal link (don't share it): https://app.patroltech.online/org-1/ABCDEF12"
    );
  });

  it('ejecutar: sin vigilante con ese identificador (o de otra organización), relanza el error', async () => {
    const err = new PatrolTechApiError(500, '/api/patrollers', null);
    pt.writeErrors = [err];
    pt.existingPatrollers = [
      { id: 'p-9', name: 'Otro', identifier: 'ABCDEF12', organizationId: 'org-ajena' },
    ];
    await expect(
      action('create_patroller').ejecutar(execCtx('es', 'ABCDEF12'), {
        nombre: 'Luis',
        identificador: 'ABCDEF12',
      })
    ).rejects.toBe(err);
  });

  it('resumen es/en', () => {
    const d = action('create_patroller');
    expect(
      d.resumen(
        { nombre: 'Luis', identificador: 'ABCDEF12' },
        { idioma: 'es', organizacion: 'Empresa Demo' }
      )
    ).toBe(
      'Crear el vigilante «Luis» en Empresa Demo. Después te daré su enlace personal de la app.'
    );
    expect(
      d.resumen(
        { nombre: 'Luis', telefono: '+34600', identificador: 'ABCDEF12' },
        { idioma: 'en', organizacion: 'Empresa Demo' }
      )
    ).toBe(
      "Create the guard «Luis» (phone +34600) in Empresa Demo. Then I'll give you their personal app link."
    );
  });
});

describe('set_alert_preference', () => {
  it('preparar: rechaza WhatsApp en una alerta que no tiene ese canal', async () => {
    const error = await prepError('set_alert_preference', {
      tipo: 'incident_assigned',
      canal: 'whatsapp',
      activar: true,
    });
    expect(error).toContain('no tiene canal WhatsApp');
  });

  it('ejecutar: manda SOLO ese tipo y canal (el backend fusiona con el resto) y confirma el cambio', async () => {
    const r = await action('set_alert_preference').ejecutar(execCtx(), {
      tipo: 'suspicious_scan',
      canal: 'whatsapp',
      activar: false,
    });
    expect(pt.writes).toEqual([
      {
        op: 'setAlertPreference',
        input: { tipo: 'suspicious_scan', canal: 'whatsapp', activar: false },
        token: 'jwt',
      },
    ]);
    expect(r.texto).toBe(
      '✅ Hecho: la alerta «Escaneo sospechoso» por WhatsApp queda desactivada para tu usuario.'
    );
  });

  it('resumen es/en: solo afecta al propio usuario', () => {
    const d = action('set_alert_preference');
    expect(
      d.resumen(
        { tipo: 'missed_route', canal: 'email', activar: true },
        { idioma: 'es', organizacion: 'Empresa Demo' }
      )
    ).toBe(
      'Activar la alerta «Ruta no completada» por email para tu usuario. Solo te afecta a ti, en todas tus organizaciones; no cambia los avisos de nadie más.'
    );
    expect(
      d.resumen(
        { tipo: 'missed_route', canal: 'push', activar: false },
        { idioma: 'en', organizacion: 'Empresa Demo' }
      )
    ).toBe(
      'Turn off the «Missed route» alert by push for your user. It only affects you, in all your organizations; nobody else’s notices change.'
    );
  });
});

// ---------------------------------------------------------------------------
// Rutas y horarios. Zona de Bogotá (UTC-5, sin cambio de hora): conversiones deterministas.
// ---------------------------------------------------------------------------

const TZ = 'America/Bogota';
const rutaPrep = (idioma: FixedTextLanguage = 'es'): ActionPrepareContext => ({
  ...prepCtx(idioma),
  tz: TZ,
});
const rutaExec = (idioma: FixedTextLanguage = 'es'): ActionContext => ({
  ...execCtx(idioma),
  tz: TZ,
});
async function okRuta(nombre: string, params: Record<string, unknown>) {
  const r = await action(nombre).preparar!(rutaPrep(), params);
  if ('error' in r) throw new Error(`preparar falló: ${r.error}`);
  return r;
}
async function errRuta(nombre: string, params: Record<string, unknown>): Promise<string> {
  const r = await action(nombre).preparar!(rutaPrep(), params);
  if (!('error' in r)) throw new Error('preparar debía fallar');
  return r.error;
}
const ES = { idioma: 'es', organizacion: 'Empresa Demo' } as const;
const EN = { idioma: 'en', organizacion: 'Empresa Demo' } as const;
/** «de lunes a viernes de 20:00 a 05:00, una ronda cada hora». */
const NOCHE = {
  dias: ['lun', 'mar', 'mie', 'jue', 'vie'],
  desde: '20:00',
  hasta: '05:00',
  repetir_cada_min: 60,
};

describe('create_route', () => {
  const base = {
    nombre: 'Ronda nocturna',
    ubicacion: 'Sede Central',
    checkpoints: ['Almacén', 'entrada'],
    franjas: [NOCHE],
  };

  it('preparar: resuelve ubicación y checkpoints (en orden) por nombre y fija el id de la ruta', async () => {
    const r = await okRuta('create_route', {
      ...base,
      ubicacion_id: 'inventado',
      checkpoint_ids: ['x'],
    });
    expect(r.params).toMatchObject({
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
      checkpoint_ids: ['cp-almacen', 'cp-entrada'],
    });
    expect(r.params.ruta_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.idempotencyKey).toBe(r.params.ruta_id);
  });

  it('preparar: checkpoint de otra ubicación o inexistente → error con las opciones de esa ubicación', async () => {
    const error = await errRuta('create_route', { ...base, checkpoints: ['Recepción'] });
    expect(error).toContain('No encuentro');
    expect(error).toContain('«Entrada principal», «Almacén»');
  });

  it('preparar: un checkpoint archivado de la ubicación → lo dice claro (no se usa en rutas), sin ofrecerlo', async () => {
    // «Garaje» está archivado en Sede Central (FakePatrolTechGateway.archivedCheckpointRefs).
    const error = await errRuta('create_route', { ...base, checkpoints: ['Almacén', 'garaje'] });
    expect(error).toContain('«Garaje» está archivado');
    expect(error).toContain('no se puede usar en rutas');
    expect(error).not.toContain('No encuentro');
  });

  it('preparar: un archivado de OTRA ubicación sigue siendo «no encuentro» (no es de esta ubicación)', async () => {
    pt.archivedCheckpointRefs = [
      {
        id: 'cp-x',
        name: 'Garaje',
        locationId: 'loc-norte',
        locationName: 'Sucursal Norte',
        metodo: null,
        codigo: null,
      },
    ];
    expect(await errRuta('create_route', { ...base, checkpoints: ['Garaje'] })).toContain(
      'No encuentro'
    );
  });

  it('preparar: sin ubicación y con varias, pregunta; con el nombre de otra ruta, no la duplica', async () => {
    expect(await errRuta('create_route', { ...base, ubicacion: undefined })).toContain(
      'pregúntale en cuál crear la ruta'
    );
    expect(await errRuta('create_route', { ...base, nombre: 'ruta norte' })).toContain(
      'Ya existe una ruta «Ruta Norte»'
    );
  });

  it('preparar: franjas solapadas o checkpoint repetido → error sin proponer', async () => {
    const solape = await errRuta('create_route', {
      ...base,
      franjas: [NOCHE, { dias: ['mar'], desde: '02:30', hasta: '03:30' }],
    });
    expect(solape).toContain('se solapa');
    expect(
      await errRuta('create_route', { ...base, checkpoints: ['Almacén', 'Almacén'] })
    ).toContain('dos veces');
  });

  it('resumen es/en: franjas en hora local, con los horarios que salen de «cada hora»', async () => {
    const { params } = await okRuta('create_route', { ...base, orden_estricto: true });
    const d = action('create_route');
    expect(d.resumen(params, ES)).toBe(
      'Crear la ruta «Ronda nocturna» en la ubicación «Sede Central» de Empresa Demo con 2 checkpoints: Almacén → entrada (hay que escanearlos en ese orden).\n' +
        'Horarios (tu hora local):\n• lun, mar, mié, jue, vie de 20:00 a 05:00 (acaba al día siguiente), una ronda cada 60 min: 9 horarios'
    );
    expect(d.resumen(params, EN)).toBe(
      'Create the route «Ronda nocturna» in the location «Sede Central» of Empresa Demo with 2 checkpoints: Almacén → entrada (they must be scanned in this order).\n' +
        'Schedule (your local time):\n• Mon, Tue, Wed, Thu, Fri from 20:00 to 05:00 (ends the next day), one round every 60 min: 9 time slots'
    );
  });

  it('ejecutar: POST /complete con ids, orden 1..n, horarios en UTC con su zona y la zona del horario', async () => {
    const { params } = await okRuta('create_route', base);
    const r = await action('create_route').ejecutar(rutaExec(), params);
    expect(pt.writes).toHaveLength(1);
    const input = pt.writes[0].input as Record<string, unknown> & { timeWindows: unknown[] };
    expect(input).toMatchObject({
      id: params.ruta_id,
      name: 'Ronda nocturna',
      organizationId: 'org-1',
      locationId: 'loc-central',
      requiresOrderedScan: false,
      checkpoints: [
        { checkpointId: 'cp-almacen', order: 1 },
        { checkpointId: 'cp-entrada', order: 2 },
      ],
      scheduleTimezone: TZ,
    });
    expect(input.timeWindows).toHaveLength(9);
    expect(input.timeWindows[0]).toEqual({
      startTime: '01:00',
      endTime: '02:00',
      days: [2, 3, 4, 5, 6],
      timezone: TZ,
    });
    expect(input.timeWindows[8]).toEqual({
      startTime: '09:00',
      endTime: '10:00',
      days: [2, 3, 4, 5, 6],
      timezone: TZ,
    });
    expect(JSON.stringify(input)).not.toContain('confirmExtraBilling');
    expect(r.texto).toBe(
      '✅ Ruta «Ronda nocturna» creada en «Sede Central» de Empresa Demo, con 2 checkpoints y 9 horarios. Ya está activa: las rondas se generan en sus horarios.'
    );
  });

  it('ejecutar: un 5xx con la ruta ya creada (mismo id) se da por hecho; un 400 se relanza', async () => {
    const { params } = await okRuta('create_route', base);
    const id = String(params.ruta_id);
    pt.writeErrors = [new PatrolTechApiError(502, '/api/routes/complete', null)];
    pt.routeDetails[id] = {
      id,
      name: 'Ronda nocturna',
      isActive: true,
      locationId: 'loc-central',
      checkpoints: [],
      timeWindows: [],
    };
    await expect(action('create_route').ejecutar(rutaExec(), params)).resolves.toHaveProperty(
      'texto'
    );

    const err = new PatrolTechApiError(400, '/api/routes/complete', {
      message: 'Two time windows of the route overlap',
    });
    pt.writeErrors = [err];
    await expect(action('create_route').ejecutar(rutaExec(), params)).rejects.toBe(err);
  });
});

describe('add_time_window', () => {
  it('preparar: resuelve la ruta y detecta el solape con sus horarios (en hora local)', async () => {
    const r = await okRuta('add_time_window', {
      ruta: 'norte',
      dias: ['sab'],
      desde: '13:00',
      hasta: '14:00',
    });
    expect(r.params).toMatchObject({ ruta: 'Ruta Norte', ruta_id: 'r-norte' });
    // r-norte tiene 18:00-19:00 UTC de lun a vie = 13:00-14:00 en Bogotá.
    const error = await errRuta('add_time_window', {
      ruta: 'norte',
      dias: ['lun'],
      desde: '13:30',
      hasta: '15:00',
    });
    expect(error).toContain(
      'el horario que ya tiene la ruta «lun, mar, mié, jue, vie 13:00-14:00»'
    );
  });

  it('preparar: ruta ambigua → error con opciones', async () => {
    expect(
      await errRuta('add_time_window', {
        ruta: 'Ruta',
        dias: ['sab'],
        desde: '13:00',
        hasta: '14:00',
      })
    ).toContain('«Ruta Norte», «Ruta Sur»');
  });

  it('resumen es/en y ejecutar: POST del horario en UTC (días desplazados) con su zona', async () => {
    const { params } = await okRuta('add_time_window', {
      ruta: 'Ruta Norte',
      dias: ['dom'],
      desde: '22:00',
      hasta: '23:00',
    });
    const d = action('add_time_window');
    expect(d.resumen(params, ES)).toBe(
      'Añadir a la ruta «Ruta Norte» de Empresa Demo el horario dom de 22:00 a 23:00 (tu hora local).'
    );
    expect(d.resumen(params, EN)).toBe(
      'Add to the route «Ruta Norte» of Empresa Demo the time slot Sun from 22:00 to 23:00 (your local time).'
    );
    const r = await d.ejecutar(rutaExec(), params);
    expect(pt.writes).toEqual([
      {
        op: 'addRouteTimeWindow',
        input: {
          routeId: 'r-norte',
          startTime: '03:00',
          endTime: '04:00',
          days: [1],
          timezone: TZ,
        },
        token: 'jwt',
      },
    ]);
    expect(r.texto).toBe('✅ Horario dom de 22:00 a 23:00 añadido a la ruta «Ruta Norte».');
  });
});

describe('delete_time_window', () => {
  beforeEach(() => {
    pt.routeDetails['r-norte'].timeWindows = [
      { id: 'tw-1', startTime: '18:00', endTime: '19:00', days: [1, 2, 3, 4, 5] }, // 13:00-14:00 local
      { id: 'tw-2', startTime: '01:00', endTime: '02:00', days: [2] }, // lun 20:00-21:00 local
    ];
  });

  it('preparar: por descripción en hora local o por número de la lista', async () => {
    const r = await okRuta('delete_time_window', {
      ruta: 'Norte',
      horario: 'lun 20:00-21:00',
      horario_id: 'inventado',
    });
    expect(r.params).toMatchObject({
      ruta: 'Ruta Norte',
      horario_id: 'tw-2',
      horario_texto: 'lun 20:00-21:00',
    });
    expect(
      (await okRuta('delete_time_window', { ruta: 'Norte', horario: '1' })).params
    ).toMatchObject({ horario_id: 'tw-1' });
  });

  it('preparar: si no casa, devuelve la lista numerada en hora local', async () => {
    const error = await errRuta('delete_time_window', { ruta: 'Norte', horario: 'el de la noche' });
    expect(error).toContain('1. lun, mar, mié, jue, vie 13:00-14:00; 2. lun 20:00-21:00');
  });

  it('resumen es/en y ejecutar: DELETE por id', async () => {
    const { params } = await okRuta('delete_time_window', { ruta: 'Norte', horario: '2' });
    const d = action('delete_time_window');
    expect(d.resumen(params, ES)).toBe(
      'Borrar de la ruta «Ruta Norte» de Empresa Demo el horario lun 20:00-21:00 (tu hora local). Dejarán de generarse rondas en él.'
    );
    expect(d.resumen(params, EN)).toBe(
      'Delete from the route «Ruta Norte» of Empresa Demo the time slot lun 20:00-21:00 (your local time). No more rounds will be generated in it.'
    );
    const r = await d.ejecutar(rutaExec(), params);
    expect(pt.writes).toEqual([
      { op: 'deleteRouteTimeWindow', input: { timeWindowId: 'tw-2' }, token: 'jwt' },
    ]);
    expect(r.texto).toBe('✅ Horario lun 20:00-21:00 borrado de la ruta «Ruta Norte».');
  });
});

describe('set_route_active', () => {
  it('preparar: no propone lo que ya está así', async () => {
    expect(await errRuta('set_route_active', { ruta: 'Norte', activa: true })).toContain(
      'ya está activa'
    );
  });

  it('resumen es/en avisa de que desactivada no genera rondas ni alertas; ejecutar: PATCH isActive', async () => {
    const { params } = await okRuta('set_route_active', { ruta: 'Norte', activa: false });
    const d = action('set_route_active');
    expect(d.resumen(params, ES)).toBe(
      'Desactivar la ruta «Ruta Norte» de Empresa Demo. Mientras esté desactivada no genera rondas ni alertas.'
    );
    expect(d.resumen(params, EN)).toBe(
      "Deactivate the route «Ruta Norte» of Empresa Demo. While it's deactivated it generates no rounds and no alerts."
    );
    const r = await d.ejecutar(rutaExec(), params);
    expect(pt.writes).toEqual([
      { op: 'setRouteActive', input: { routeId: 'r-norte', isActive: false }, token: 'jwt' },
    ]);
    expect(r.texto).toBe('✅ Ruta «Ruta Norte» desactivada: no generará rondas ni alertas.');

    const act = await okRuta('set_route_active', { ruta: 'Sur', activa: true });
    expect(d.resumen(act.params, ES)).toBe(
      'Activar la ruta «Ruta Sur» de Empresa Demo: volverá a generar rondas y alertas en sus horarios.'
    );
  });
});

describe('set_route_active: una ruta sin checkpoints no se puede activar', () => {
  const sur = (checkpoints: { checkpointId: string; order: number }[]) => {
    pt.routeDetails['r-sur'] = {
      id: 'r-sur',
      name: 'Ruta Sur',
      isActive: false,
      locationId: 'loc-central',
      checkpoints,
      timeWindows: [],
    };
  };

  it('preparar activar una ruta vacía: no lo propone y dice que primero hay que añadirle checkpoints', async () => {
    sur([]);
    const error = await errRuta('set_route_active', { ruta: 'Sur', activa: true });
    expect(error).toContain('«Ruta Sur» no tiene checkpoints');
    expect(error).toContain('no se puede activar');
    expect(error).toContain('añadirle checkpoints');
  });

  it('preparar activar una ruta con checkpoints sí lo propone', async () => {
    sur([{ checkpointId: 'cp-entrada', order: 1 }]);
    expect((await okRuta('set_route_active', { ruta: 'Sur', activa: true })).params).toMatchObject({
      ruta_id: 'r-sur',
      activa: true,
    });
  });

  it('desactivar no mira los checkpoints', async () => {
    pt.routeDetails['r-norte'].checkpoints = [];
    expect(
      (await okRuta('set_route_active', { ruta: 'Norte', activa: false })).params
    ).toMatchObject({ ruta_id: 'r-norte', activa: false });
  });
});

describe('route_checkpoint', () => {
  it('añadir: solo checkpoints de la ubicación de la ruta, al final; no uno que ya lleva', async () => {
    const r = await okRuta('route_checkpoint', {
      ruta: 'Norte',
      checkpoint: 'almacén',
      operacion: 'añadir',
    });
    expect(r.params).toMatchObject({
      checkpoint: 'Almacén',
      ruta_id: 'r-norte',
      checkpoint_id: 'cp-almacen',
      orden: 2,
    });
    expect(
      await errRuta('route_checkpoint', {
        ruta: 'Norte',
        checkpoint: 'Recepción',
        operacion: 'añadir',
      })
    ).toContain('No encuentro');
    expect(
      await errRuta('route_checkpoint', {
        ruta: 'Norte',
        checkpoint: 'Entrada',
        operacion: 'añadir',
      })
    ).toContain('ya está en la ruta');
  });

  it('añadir: un checkpoint archivado de la ubicación de la ruta → lo dice claro, sin proponer', async () => {
    const error = await errRuta('route_checkpoint', {
      ruta: 'Norte',
      checkpoint: 'Garaje',
      operacion: 'añadir',
    });
    expect(error).toContain('«Garaje» está archivado');
    expect(error).toContain('no se puede usar en rutas');
  });

  it('quitar: solo de los que lleva la ruta', async () => {
    const r = await okRuta('route_checkpoint', {
      ruta: 'Norte',
      checkpoint: 'Entrada',
      operacion: 'quitar',
    });
    expect(r.params).toMatchObject({
      checkpoint: 'Entrada principal',
      checkpoint_id: 'cp-entrada',
    });
    expect(
      await errRuta('route_checkpoint', {
        ruta: 'Norte',
        checkpoint: 'Almacén',
        operacion: 'quitar',
      })
    ).toContain('«Entrada principal»');
  });

  it('resumen es/en y ejecutar: POST con el orden / DELETE', async () => {
    const d = action('route_checkpoint');
    const add = await okRuta('route_checkpoint', {
      ruta: 'Norte',
      checkpoint: 'Almacén',
      operacion: 'añadir',
    });
    expect(d.resumen(add.params, ES)).toBe(
      'Añadir el checkpoint «Almacén» al final de la ruta «Ruta Norte» de Empresa Demo. Las rondas nuevas lo incluirán.'
    );
    expect(d.resumen(add.params, EN)).toBe(
      'Add the checkpoint «Almacén» at the end of the route «Ruta Norte» of Empresa Demo. New rounds will include it.'
    );
    expect((await d.ejecutar(rutaExec(), add.params)).texto).toBe(
      '✅ Checkpoint «Almacén» añadido a la ruta «Ruta Norte».'
    );

    pt.routeDetails['r-norte'].checkpoints.push({ checkpointId: 'cp-almacen', order: 2 });
    const rm = await okRuta('route_checkpoint', {
      ruta: 'Norte',
      checkpoint: 'Entrada',
      operacion: 'quitar',
    });
    expect(d.resumen(rm.params, ES)).toBe(
      'Quitar el checkpoint «Entrada principal» de la ruta «Ruta Norte» de Empresa Demo. Las rondas dejarán de pedirlo (el checkpoint no se borra).'
    );
    expect((await d.ejecutar(rutaExec('en'), rm.params)).texto).toBe(
      '✅ Checkpoint «Entrada principal» removed from the route «Ruta Norte».'
    );
    expect(pt.writes).toEqual([
      {
        op: 'addCheckpointToRoute',
        input: { routeId: 'r-norte', checkpointId: 'cp-almacen', order: 2 },
        token: 'jwt',
      },
      {
        op: 'removeCheckpointFromRoute',
        input: { routeId: 'r-norte', checkpointId: 'cp-entrada' },
        token: 'jwt',
      },
    ]);
  });
});

describe('route_checkpoint: quitar el último checkpoint desactiva la ruta (como el backend)', () => {
  it('preparar marca desactiva solo si es el único checkpoint de una ruta activa', async () => {
    expect(
      (
        await okRuta('route_checkpoint', {
          ruta: 'Norte',
          checkpoint: 'Entrada',
          operacion: 'quitar',
        })
      ).params
    ).toMatchObject({ desactiva: true });

    pt.routeDetails['r-norte'].checkpoints.push({ checkpointId: 'cp-almacen', order: 2 });
    expect(
      (
        await okRuta('route_checkpoint', {
          ruta: 'Norte',
          checkpoint: 'Entrada',
          operacion: 'quitar',
        })
      ).params
    ).toMatchObject({ desactiva: false });
  });

  it('una ruta ya inactiva que se queda vacía no avisa de desactivarla', async () => {
    pt.routeDetails['r-norte'].isActive = false;
    expect(
      (
        await okRuta('route_checkpoint', {
          ruta: 'Norte',
          checkpoint: 'Entrada',
          operacion: 'quitar',
        })
      ).params
    ).toMatchObject({ desactiva: false });
  });

  it('resumen: avisa en es/en/fr de que la ruta se queda vacía y se desactiva', async () => {
    const d = action('route_checkpoint');
    const { params } = await okRuta('route_checkpoint', {
      ruta: 'Norte',
      checkpoint: 'Entrada',
      operacion: 'quitar',
    });
    expect(d.resumen(params, ES)).toBe(
      'Quitar el checkpoint «Entrada principal» de la ruta «Ruta Norte» de Empresa Demo. Las rondas dejarán de pedirlo (el checkpoint no se borra).\n' +
        '⚠️ La ruta «Ruta Norte» se quedará sin checkpoints y se desactivará: no generará rondas hasta que le añadas checkpoints y la vuelvas a activar.'
    );
    expect(d.resumen(params, EN)).toBe(
      "Remove the checkpoint «Entrada principal» from the route «Ruta Norte» of Empresa Demo. Rounds will no longer ask for it (the checkpoint isn't deleted).\n" +
        "⚠️ The route «Ruta Norte» will be left without checkpoints and deactivated: it won't generate rounds until you add checkpoints and activate it again."
    );
    expect(d.resumen(params, { idioma: 'fr', organizacion: 'Empresa Demo' })).toBe(
      "Retirer le checkpoint «Entrada principal» du parcours «Ruta Norte» de Empresa Demo. Les rondes ne le demanderont plus (le checkpoint n'est pas supprimé).\n" +
        "⚠️ Le parcours «Ruta Norte» restera sans checkpoints et sera désactivé : il ne générera plus de rondes tant que vous n'y ajouterez pas de checkpoints et ne le réactiverez pas."
    );
  });

  it('ejecutar: lo dice solo si el backend la ha dejado inactiva', async () => {
    const d = action('route_checkpoint');
    const { params } = await okRuta('route_checkpoint', {
      ruta: 'Norte',
      checkpoint: 'Entrada',
      operacion: 'quitar',
    });
    // El backend la vacía y la desactiva; el fake no lo hace solo.
    pt.routeDetails['r-norte'] = {
      ...pt.routeDetails['r-norte'],
      isActive: false,
      checkpoints: [],
    };
    expect((await d.ejecutar(rutaExec(), params)).texto).toBe(
      '✅ Checkpoint «Entrada principal» quitado de la ruta «Ruta Norte».\nLa ruta se ha quedado sin checkpoints y se ha desactivado.'
    );
    expect((await d.ejecutar(rutaExec('en'), params)).texto).toBe(
      '✅ Checkpoint «Entrada principal» removed from the route «Ruta Norte».\nThe route has no checkpoints left and has been deactivated.'
    );
    expect((await d.ejecutar(rutaExec('fr'), params)).texto).toBe(
      "✅ Checkpoint «Entrada principal» retiré du parcours «Ruta Norte».\nLe parcours n'a plus de checkpoints et a été désactivé."
    );
  });

  it('ejecutar: si la ruta sigue activa, o no se puede releer, no añade nada (el cambio ya está hecho)', async () => {
    const d = action('route_checkpoint');
    const { params } = await okRuta('route_checkpoint', {
      ruta: 'Norte',
      checkpoint: 'Entrada',
      operacion: 'quitar',
    });
    expect((await d.ejecutar(rutaExec(), params)).texto).toBe(
      '✅ Checkpoint «Entrada principal» quitado de la ruta «Ruta Norte».'
    );
    delete pt.routeDetails['r-norte'];
    expect((await d.ejecutar(rutaExec(), params)).texto).toBe(
      '✅ Checkpoint «Entrada principal» quitado de la ruta «Ruta Norte».'
    );
  });
});

describe('textos en francés', () => {
  it('resumen de create_checkpoint en francés', () => {
    const p = {
      nombre: 'Entrada',
      metodo: 'qr',
      ubicacion: 'Sede Central',
      ubicacion_id: 'loc-central',
    };
    expect(
      action('create_checkpoint').resumen(p, { idioma: 'fr', organizacion: 'Empresa Demo' })
    ).toBe(
      'Créer le checkpoint «Entrada» sur le site «Sede Central» de Empresa Demo, avec un QR code (à imprimer et coller au point de contrôle). ' +
        'Le code est généré par le tableau de bord.'
    );
  });

  it('create_patroller en francés: el aviso y el mensaje para reenviar al vigilante, también en francés', async () => {
    const r = await action('create_patroller').ejecutar(execCtx('fr', 'ABCDEF12'), {
      nombre: 'Luis',
      identificador: 'ABCDEF12',
    });
    expect(r.texto).toContain('✅ Agent «Luis» créé dans Empresa Demo.');
    expect(r.texto).toContain('jamais à un groupe');
    expect(r.texto).toContain(
      'Message prêt à transférer à Luis par WhatsApp ou e-mail :\n\nBonjour Luis,'
    );
    expect(r.texto).toContain(
      'Votre lien personnel (ne le partagez pas) : https://app.patroltech.online/org-1/ABCDEF12'
    );
  });

  it('resumen de create_route en francés, con los días en francés', async () => {
    const { params } = await okRuta('create_route', {
      nombre: 'Ronda nocturna',
      ubicacion: 'Sede Central',
      checkpoints: ['Almacén', 'entrada'],
      franjas: [NOCHE],
      orden_estricto: true,
    });
    expect(
      action('create_route').resumen(params, { idioma: 'fr', organizacion: 'Empresa Demo' })
    ).toBe(
      'Créer le parcours «Ronda nocturna» sur le site «Sede Central» de Empresa Demo avec 2 checkpoints : Almacén → entrada (à scanner dans cet ordre).\n' +
        'Horaires (votre heure locale) :\n• lun, mar, mer, jeu, ven de 20:00 à 05:00 (se termine le lendemain), une ronde toutes les 60 min : 9 créneaux'
    );
  });
});
