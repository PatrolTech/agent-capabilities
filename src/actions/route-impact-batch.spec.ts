import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { actionCatalog } from './index.js';
import type { ActionContext, ActionDefinition, ActionPrepareContext } from './types.js';
import { nuevoTurno, type TurnoConRegistro } from './support/turno.js';
import { listaCitada } from './support/shared.js';
import type { Logger } from '../ports/Logger.js';
import { FakePatrolTechGateway } from '../testing/FakePatrolTechGateway.js';
import type { RouteDetails } from '../gateway/index.js';

/**
 * Lo que una propuesta sabe de las anteriores del mismo lote (rutas que se
 * quedan vacías entre varias), las lecturas de rutas compartidas por el turno y
 * el aviso tras quitar un checkpoint.
 */

const ORG = { orgId: 'org-1', name: 'Empresa Demo' };
const prepCtx = (turno?: TurnoConRegistro): ActionPrepareContext => ({
  org: ORG,
  organizations: [ORG],
  token: 'jwt',
  country: 'ES',
  language: 'es',
  tz: 'Europe/Madrid',
  user: { id: 'u-yo', name: 'Ana García' },
  turno,
});
const execCtx = (): ActionContext => ({ ...prepCtx(), idempotencyKey: null });

let pt: FakePatrolTechGateway;
let logger: Logger & { warn: Mock<Logger['warn']> };
let catalog: ActionDefinition[];
const action = (nombre: string): ActionDefinition => catalog.find((d) => d.nombre === nombre)!;

const ruta = (
  id: string,
  name: string,
  isActive: boolean,
  checkpointIds: string[],
  locationId = 'loc-central'
): RouteDetails => ({
  id,
  name,
  isActive,
  locationId,
  checkpoints: checkpointIds.map((checkpointId, i) => ({ checkpointId, order: i + 1 })),
  timeWindows: [],
});

/** `preparar` dentro de un turno, anotando lo que cambia (lo que hace el colector al aceptarla). */
async function enTurno(
  turno: TurnoConRegistro,
  nombre: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const r = await action(nombre).preparar!(prepCtx(turno), params);
  if ('error' in r) throw new Error(`preparar falló: ${r.error}`);
  turno.registrar(r.cambiosEnRutas ?? []);
  return r.params;
}

beforeEach(() => {
  pt = new FakePatrolTechGateway();
  pt.routes = [
    { id: 'r-norte', name: 'Ruta Norte', isActive: true, locationId: 'loc-central' },
    { id: 'r-sur', name: 'Ruta Sur', isActive: false, locationId: 'loc-central' },
  ];
  pt.routeDetails['r-norte'] = ruta('r-norte', 'Ruta Norte', true, ['cp-entrada', 'cp-almacen']);
  pt.routeDetails['r-sur'] = ruta('r-sur', 'Ruta Sur', false, ['cp-recepcion']);
  logger = { info: vi.fn(), warn: vi.fn<Logger['warn']>(), error: vi.fn() };
  catalog = actionCatalog({ gateway: pt, logger });
});

describe('lote: quitar de una ruta varios checkpoints en la misma confirmación', () => {
  const quitar = (checkpoint: string) => ({ ruta: 'Norte', checkpoint, operacion: 'quitar' });
  const anadir = (checkpoint: string) => ({ ruta: 'Norte', checkpoint, operacion: 'añadir' });

  it('cada uno por separado no la vacía; el segundo del lote sí, y avisa', async () => {
    const turno = nuevoTurno();
    expect(await enTurno(turno, 'route_checkpoint', quitar('Entrada'))).toMatchObject({
      desactiva: false,
    });
    expect(await enTurno(turno, 'route_checkpoint', quitar('Almacén'))).toMatchObject({
      desactiva: true,
    });
  });

  it('añadir antes de quitar el último: no se queda vacía', async () => {
    pt.routeDetails['r-norte'] = ruta('r-norte', 'Ruta Norte', true, ['cp-entrada']);
    pt.checkpointRefs.push({
      id: 'cp-patio',
      name: 'Patio',
      locationId: 'loc-central',
      locationName: 'Sede Central',
      metodo: 'qr_static',
      codigo: 'P-1',
    });
    const turno = nuevoTurno();
    await enTurno(turno, 'route_checkpoint', anadir('Patio'));
    expect(await enTurno(turno, 'route_checkpoint', quitar('Entrada'))).toMatchObject({
      desactiva: false,
    });
  });

  it('quitar el último y después añadir: el quitar avisa (la ruta se desactiva aunque luego tenga uno)', async () => {
    pt.routeDetails['r-norte'] = ruta('r-norte', 'Ruta Norte', true, ['cp-entrada']);
    const turno = nuevoTurno();
    expect(await enTurno(turno, 'route_checkpoint', quitar('Entrada'))).toMatchObject({
      desactiva: true,
    });
    await enTurno(turno, 'route_checkpoint', anadir('Almacén'));
  });

  it('dos añadidos en el lote van uno detrás de otro al final de la ruta', async () => {
    pt.checkpointRefs.push({
      id: 'cp-patio',
      name: 'Patio',
      locationId: 'loc-central',
      locationName: 'Sede Central',
      metodo: 'qr_static',
      codigo: 'P-1',
    });
    pt.checkpointRefs.push({
      id: 'cp-muelle',
      name: 'Muelle',
      locationId: 'loc-central',
      locationName: 'Sede Central',
      metodo: 'qr_static',
      codigo: 'M-1',
    });
    const turno = nuevoTurno();
    expect(await enTurno(turno, 'route_checkpoint', anadir('Patio'))).toMatchObject({ orden: 3 });
    expect(await enTurno(turno, 'route_checkpoint', anadir('Muelle'))).toMatchObject({ orden: 4 });
  });

  it('archivar dos checkpoints de la misma ruta: el segundo avisa de que la vacía', async () => {
    const turno = nuevoTurno();
    expect(
      (await enTurno(turno, 'archive_checkpoint', { checkpoint: 'Entrada', archivar: true })).rutas
    ).toEqual([{ id: 'r-norte', name: 'Ruta Norte', leftEmpty: false, deactivated: false }]);
    expect(
      (await enTurno(turno, 'archive_checkpoint', { checkpoint: 'Almacén', archivar: true })).rutas
    ).toEqual([{ id: 'r-norte', name: 'Ruta Norte', leftEmpty: true, deactivated: true }]);
  });

  it('quitar de la ruta y archivar el otro: el archivado avisa', async () => {
    const turno = nuevoTurno();
    await enTurno(turno, 'route_checkpoint', quitar('Entrada'));
    expect(
      (await enTurno(turno, 'archive_checkpoint', { checkpoint: 'Almacén', archivar: true })).rutas
    ).toEqual([{ id: 'r-norte', name: 'Ruta Norte', leftEmpty: true, deactivated: true }]);
  });
});

// El colector del lote (preparar en el orden de las llamadas, descartar la repetida) es del motor
// de cada consumidor; aquí, lo que aporta la acción: lo que ve del turno y su `huella`.
describe('turno: las propuestas se preparan en orden y ven las anteriores', () => {
  /** `preparar` dentro del turno; solo anota los cambios si sale bien (lo que hace el colector). */
  async function proponer(
    turno: TurnoConRegistro,
    nombre: string,
    params: Record<string, unknown>
  ) {
    const r = await action(nombre).preparar!(prepCtx(turno), params);
    if (!('error' in r)) turno.registrar(r.cambiosEnRutas ?? []);
    return r;
  }

  it('dos veces el mismo añadido en el turno: la segunda ve la primera', async () => {
    const turno = nuevoTurno();
    const anadir = { ruta: 'Norte', checkpoint: 'Recepción', operacion: 'añadir' };
    pt.checkpointRefs[2] = {
      ...pt.checkpointRefs[2],
      locationId: 'loc-central',
      locationName: 'Sede Central',
    };
    expect('params' in (await proponer(turno, 'route_checkpoint', anadir))).toBe(true);
    expect(await proponer(turno, 'route_checkpoint', anadir)).toMatchObject({
      error: expect.stringContaining('ya está propuesto en el lote pendiente'),
    });
  });

  it('quitar dos veces el mismo checkpoint (con «desactiva» distinto): la segunda se rechaza', async () => {
    pt.routeDetails['r-norte'] = ruta('r-norte', 'Ruta Norte', true, ['cp-entrada']);
    const turno = nuevoTurno();
    const quitar = { ruta: 'Norte', checkpoint: 'Entrada', operacion: 'quitar' };
    expect('params' in (await proponer(turno, 'route_checkpoint', quitar))).toBe(true);
    const segunda = await proponer(turno, 'route_checkpoint', quitar);
    expect(segunda).toMatchObject({ error: expect.stringContaining('no lo repitas') });
    // Texto neutral de canal: ni «turno» (del bot) ni nada que el MCP no tenga.
    expect(segunda).toMatchObject({ error: expect.stringContaining('del lote pendiente') });
    expect(JSON.stringify(segunda)).not.toContain('turno');
  });

  it('archivar dos veces el mismo (con «rutas» distintas): la misma huella, así que es la misma propuesta', async () => {
    const turno = nuevoTurno();
    const archivar = { checkpoint: 'Entrada', archivar: true };
    const d = action('archive_checkpoint');
    const primera = await enTurno(turno, 'archive_checkpoint', archivar);
    const segunda = await enTurno(turno, 'archive_checkpoint', archivar);
    expect(segunda.rutas).not.toEqual(primera.rutas);
    expect(d.huella!(segunda)).toEqual(d.huella!(primera));
  });

  it('quitar X y luego volver a añadirlo en el mismo lote sí se puede', async () => {
    const turno = nuevoTurno();
    expect(
      'params' in
        (await proponer(turno, 'route_checkpoint', {
          ruta: 'Norte',
          checkpoint: 'Entrada',
          operacion: 'quitar',
        }))
    ).toBe(true);
    expect(
      'params' in
        (await proponer(turno, 'route_checkpoint', {
          ruta: 'Norte',
          checkpoint: 'Entrada',
          operacion: 'añadir',
        }))
    ).toBe(true);
  });

  it('las lecturas de rutas se comparten: dos archivados leen la lista y cada ruta una sola vez', async () => {
    let listas = 0;
    const detalles: string[] = [];
    const listRoutes = pt.listRoutes.bind(pt);
    const getRouteDetails = pt.getRouteDetails.bind(pt);
    pt.listRoutes = async (...a) => ((listas += 1), listRoutes(...a));
    pt.getRouteDetails = async (id, token) => (detalles.push(id), getRouteDetails(id, token));
    const turno = nuevoTurno();
    expect(
      'params' in
        (await proponer(turno, 'archive_checkpoint', { checkpoint: 'Entrada', archivar: true }))
    ).toBe(true);
    expect(
      'params' in
        (await proponer(turno, 'archive_checkpoint', { checkpoint: 'Almacén', archivar: true }))
    ).toBe(true);
    expect(listas).toBe(1);
    expect(detalles.sort()).toEqual(['r-norte', 'r-sur']);
  });
});

describe('archivar: solo lee las rutas de la ubicación del checkpoint, pocas a la vez', () => {
  it('no lee las rutas de otras ubicaciones (sí las de ubicación desconocida)', async () => {
    pt.routes.push({ id: 'r-otra', name: 'Ruta Otra', isActive: true, locationId: 'loc-norte' });
    pt.routes.push({ id: 'r-sin', name: 'Ruta Sin Ubicación', isActive: true, locationId: null });
    const leidas: string[] = [];
    const getRouteDetails = pt.getRouteDetails.bind(pt);
    pt.getRouteDetails = async (id, token) => (leidas.push(id), getRouteDetails(id, token));
    await action('archive_checkpoint').preparar!(prepCtx(), {
      checkpoint: 'Entrada',
      archivar: true,
    });
    expect(leidas.sort()).toEqual(['r-norte', 'r-sin', 'r-sur']);
  });

  it('una ruta de su ubicación que no se puede leer (detalle null): «no se sabe», aviso genérico', async () => {
    delete pt.routeDetails['r-sur'];
    const r = await action('archive_checkpoint').preparar!(prepCtx(), {
      checkpoint: 'Entrada',
      archivar: true,
    });
    expect('params' in r && r.params.rutas).toBeUndefined();
  });

  it('como mucho 5 lecturas de detalle a la vez', async () => {
    pt.routes = Array.from({ length: 12 }, (_, i) => ({
      id: `r-${i}`,
      name: `Ruta ${i}`,
      isActive: true,
      locationId: 'loc-central',
    }));
    let enVuelo = 0;
    let maximo = 0;
    pt.getRouteDetails = async (id) => {
      enVuelo += 1;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((r) => setTimeout(r, 2));
      enVuelo -= 1;
      return ruta(id, id, true, ['cp-entrada']);
    };
    const r = await action('archive_checkpoint').preparar!(prepCtx(), {
      checkpoint: 'Entrada',
      archivar: true,
    });
    expect('params' in r && (r.params.rutas as unknown[]).length).toBe(12);
    expect(maximo).toBe(5);
  });
});

describe('route_checkpoint ejecutar: el aviso de ruta desactivada sale de lo previsto', () => {
  const quitar = { ruta: 'Norte', checkpoint: 'Entrada', operacion: 'quitar' };

  it('una ruta que YA estaba inactiva no «se ha desactivado», aunque quede vacía', async () => {
    pt.routeDetails['r-norte'] = ruta('r-norte', 'Ruta Norte', false, ['cp-entrada']);
    const r = await action('route_checkpoint').preparar!(prepCtx(), quitar);
    if ('error' in r) throw new Error(r.error);
    expect(r.params).toMatchObject({ desactiva: false });
    pt.routeDetails['r-norte'] = ruta('r-norte', 'Ruta Norte', false, []);
    expect((await action('route_checkpoint').ejecutar(execCtx(), r.params)).texto).toBe(
      '✅ Checkpoint «Entrada principal» quitado de la ruta «Ruta Norte».'
    );
  });

  it('si no se puede releer, lo registra y no añade nada (el cambio ya está hecho)', async () => {
    pt.getRouteDetails = async () => {
      throw new Error('caído');
    };
    const params = {
      ...quitar,
      checkpoint: 'Entrada principal',
      ruta: 'Ruta Norte',
      ruta_id: 'r-norte',
      checkpoint_id: 'cp-entrada',
      desactiva: true,
    };
    expect((await action('route_checkpoint').ejecutar(execCtx(), params)).texto).toBe(
      '✅ Checkpoint «Entrada principal» quitado de la ruta «Ruta Norte».'
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'bot_action.route_checkpoint_reread_failed',
      expect.objectContaining({ rutaId: 'r-norte' })
    );
  });
});

describe('set_route_active: activar una ruta vacía va en dos confirmaciones', () => {
  it('quitar el último checkpoint y activarla en el mismo lote: no se propone', async () => {
    pt.routes[0] = { ...pt.routes[0], isActive: false };
    pt.routeDetails['r-norte'] = ruta('r-norte', 'Ruta Norte', false, ['cp-entrada']);
    const turno = nuevoTurno();
    await enTurno(turno, 'route_checkpoint', {
      ruta: 'Norte',
      checkpoint: 'Entrada',
      operacion: 'quitar',
    });
    const r = await action('set_route_active').preparar!(prepCtx(turno), {
      ruta: 'Norte',
      activa: true,
    });
    expect('error' in r && r.error).toContain('no tiene checkpoints');
  });

  it('la descripción le dice al modelo que primero se confirman los checkpoints y después se activa', () => {
    expect(action('set_route_active').descripcion).toContain('primero propón añadirle checkpoints');
    expect(action('set_route_active').descripcion).toContain('en otra confirmación');
  });
});

describe('listaCitada: como mucho 10 nombres en un resumen', () => {
  it('con más de 10, los primeros y «y N más» en el idioma del cliente', () => {
    const nombres = Array.from({ length: 12 }, (_, i) => `R${i + 1}`);
    expect(listaCitada(nombres)).toBe(
      '«R1», «R2», «R3», «R4», «R5», «R6», «R7», «R8», «R9», «R10» y 2 más'
    );
    expect(listaCitada(nombres, 'en')).toMatch(/«R10» and 2 more$/);
    expect(listaCitada(nombres, 'fr')).toMatch(/«R10» et 2 de plus$/);
    expect(listaCitada(['A', 'B'])).toBe('«A», «B»');
  });

  it('archivar en muchas rutas: el resumen no las lista todas', () => {
    const rutas = Array.from({ length: 13 }, (_, i) => ({
      id: `r-${i}`,
      name: `Ruta ${i + 1}`,
      leftEmpty: false,
      deactivated: false,
    }));
    const resumen = action('archive_checkpoint').resumen(
      { checkpoint: 'Entrada principal', ubicacion: 'Sede Central', archivar: true, rutas },
      { idioma: 'es', organizacion: 'Empresa Demo' }
    );
    expect(resumen).toContain('«Ruta 10» y 3 más');
    expect(resumen).not.toContain('«Ruta 11»');
  });
});
