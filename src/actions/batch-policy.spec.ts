import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  aceptarEnLote,
  huellaDePropuesta,
  liberarEnLote,
  LOTE_VACIO,
  MAX_POR_LOTE,
  reservarEnLote,
  type EstadoDelLote,
} from './batch-policy.js';
import { actionCatalog } from './index.js';
import { nuevoTurno } from './support/turno.js';
import type { ActionDefinition, ActionPrepareContext } from './types.js';
import { FakePatrolTechGateway } from '../testing/FakePatrolTechGateway.js';

/**
 * La política del lote con las acciones reales, como la usaría el motor de un
 * consumidor: reservar, preparar, y aceptar o liberar. El orden de la lista y la
 * serialización de las llamadas a la vez son del motor y no se prueban aquí.
 */

const ORG = { orgId: 'org-1', name: 'Empresa Demo' };
const prepCtx: Omit<ActionPrepareContext, 'turno'> = {
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

/** Un colector mínimo sobre la política: lo que hará `collectProposals` del bot. */
function lote() {
  let estado: EstadoDelLote = LOTE_VACIO;
  const turno = nuevoTurno();
  let aceptadas = 0;
  return {
    async propose(nombre: string, params: Record<string, unknown>) {
      const def = action(nombre);
      const reserva = reservarEnLote(estado, def.nombre);
      if (!reserva.ok) return reserva;
      estado = reserva.estado;
      let r: Awaited<ReturnType<NonNullable<ActionDefinition['preparar']>>>;
      try {
        r = await def.preparar!({ ...prepCtx, turno }, z.object(def.params).parse(params));
      } catch (err) {
        estado = liberarEnLote(estado, def.nombre);
        throw err;
      }
      if ('error' in r) {
        estado = liberarEnLote(estado, def.nombre);
        return { ok: false as const, error: r.error };
      }
      const aceptada = aceptarEnLote(estado, {
        definition: def,
        orgId: ORG.orgId,
        params: r.params,
      });
      if (!aceptada.ok) return aceptada;
      estado = aceptada.estado;
      turno.registrar(r.cambiosEnRutas ?? []);
      aceptadas += 1;
      return { ok: true as const };
    },
    size: () => aceptadas,
  };
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

describe('lote: borrar ubicaciones en el mismo turno', () => {
  it('si el primer borrado falla (nombre mal escrito), el reintento corregido en el mismo turno SÍ se admite', async () => {
    const c = lote();
    const primero = await c.propose('delete_location', { ubicacion: 'Sucursal Nrte' });
    expect(primero.ok).toBe(false);
    const reintento = await c.propose('delete_location', { ubicacion: 'Sucursal Norte' });
    expect(reintento).toMatchObject({ ok: true });
    expect(c.size()).toBe(1);
  });

  it('dos borrados válidos en el mismo turno: el segundo se rechaza; una edición junto al borrado sí entra', async () => {
    pt.locations.push({ id: 'loc-sur', name: 'Sucursal Sur', address: null });
    const c = lote();
    expect((await c.propose('delete_location', { ubicacion: 'Sucursal Norte' })).ok).toBe(true);
    expect(await c.propose('delete_location', { ubicacion: 'Sucursal Sur' })).toEqual({
      ok: false,
      error:
        'Solo se puede borrar una ubicación por confirmación: propón la siguiente cuando esta esté hecha.',
    });
    expect(
      (await c.propose('edit_location', { ubicacion: 'Sede Central', nombre: 'Oficinas' })).ok
    ).toBe(true);
    expect(c.size()).toBe(2);
  });

  it('un borrado cuyo preparar LANZA (backend caído) tampoco bloquea el reintento', async () => {
    const c = lote();
    const original = pt.listLocations.bind(pt);
    pt.listLocations = () => Promise.reject(new Error('ECONNRESET'));
    await expect(c.propose('delete_location', { ubicacion: 'Sucursal Norte' })).rejects.toThrow(
      'ECONNRESET'
    );
    pt.listLocations = original;
    expect((await c.propose('delete_location', { ubicacion: 'Sucursal Norte' })).ok).toBe(true);
  });
});

describe('lote: máximo por confirmación', () => {
  it('la propuesta 11 del turno falla: máximo 10 por confirmación', async () => {
    const c = lote();
    const r = [];
    for (let i = 1; i <= 11; i++) {
      r.push(await c.propose('edit_location', { ubicacion: 'Sede Central', nombre: `Sede ${i}` }));
    }
    expect(r.slice(0, 10).every((x) => x.ok)).toBe(true);
    expect(r[10]).toEqual({
      ok: false,
      error: 'máximo 10 por confirmación; propón el resto después',
    });
    expect(c.size()).toBe(10);
  });

  it('el hueco de una propuesta rechazada sigue contando para el máximo', () => {
    let estado = LOTE_VACIO;
    for (let i = 0; i < MAX_POR_LOTE; i++) {
      const r = reservarEnLote(estado, 'edit_location');
      if (!r.ok) throw new Error(r.error);
      // Rechazada al preparar: se libera, pero el hueco no vuelve.
      estado = liberarEnLote(r.estado, 'edit_location');
    }
    expect(reservarEnLote(estado, 'edit_location')).toEqual({
      ok: false,
      error: 'máximo 10 por confirmación; propón el resto después',
    });
  });
});

describe('lote: la misma propuesta dos veces', () => {
  const REPETIDA =
    'Esta acción ya está propuesta en este turno con los mismos datos (la misma organización, persona, checkpoint…): no la repitas. ' +
    'Va una sola vez en la confirmación.';

  it('archivar dos veces el mismo (con «rutas» distintas): la segunda se rechaza por su huella', async () => {
    pt.routes = [{ id: 'r-norte', name: 'Ruta Norte', isActive: true, locationId: 'loc-central' }];
    pt.routeDetails['r-norte'] = {
      id: 'r-norte',
      name: 'Ruta Norte',
      isActive: true,
      locationId: 'loc-central',
      checkpoints: [
        { checkpointId: 'cp-entrada', order: 1 },
        { checkpointId: 'cp-almacen', order: 2 },
      ],
      timeWindows: [],
    };
    const c = lote();
    const archivar = { checkpoint: 'Entrada', archivar: true };
    expect((await c.propose('archive_checkpoint', archivar)).ok).toBe(true);
    expect(await c.propose('archive_checkpoint', archivar)).toEqual({ ok: false, error: REPETIDA });
    expect(c.size()).toBe(1);
  });

  it('sin huella, los parámetros preparados: dicha de otra forma, la misma persona y acceso es repetida', async () => {
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
        email: 'Pedro.Gil@Acme.test',
        roles: [
          { id: 'r-pedro-org', rol: 'VIEWER', ambito: 'ORGANIZATION', scopeId: 'org-1' },
          { id: 'r-pedro-norte', rol: 'EDITOR', ambito: 'LOCATION', scopeId: 'loc-norte' },
        ],
      },
    ];
    const c = lote();
    expect(await c.propose('remove_user_access', { usuario: 'Pedro', acceso: '2' })).toEqual({
      ok: true,
    });
    expect(
      await c.propose('remove_user_access', { usuario: 'pedro.gil@acme.test', acceso: '2' })
    ).toEqual({ ok: false, error: REPETIDA });
    expect(await c.propose('remove_user_access', { usuario: 'Pedro', acceso: '1' })).toEqual({
      ok: true,
    });
    expect(await c.propose('remove_user_access', { usuario: 'Pedro', acceso: 'norte' })).toEqual({
      ok: false,
      error: REPETIDA,
    });
    expect(c.size()).toBe(2);
  });

  it('la huella no depende del orden de las claves, pero sí de la organización y de la acción', () => {
    const d = action('edit_location');
    const a = huellaDePropuesta({
      definition: d,
      orgId: 'org-1',
      params: { ubicacion: 'X', nombre: 'Y' },
    });
    expect(
      huellaDePropuesta({ definition: d, orgId: 'org-1', params: { nombre: 'Y', ubicacion: 'X' } })
    ).toBe(a);
    expect(
      huellaDePropuesta({ definition: d, orgId: 'org-2', params: { ubicacion: 'X', nombre: 'Y' } })
    ).not.toBe(a);
    expect(
      huellaDePropuesta({
        definition: action('delete_location'),
        orgId: 'org-1',
        params: { ubicacion: 'X', nombre: 'Y' },
      })
    ).not.toBe(a);
  });
});
