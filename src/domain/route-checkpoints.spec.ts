import { describe, it, expect } from 'vitest';
import { aplicarCambios, efectoDeQuitar, type CambioDeCheckpoint } from './route-checkpoints.js';

const ruta = (isActive: boolean, ...ids: string[]) => ({
  isActive,
  checkpoints: ids.map((checkpointId) => ({ checkpointId })),
});

describe('efectoDeQuitar', () => {
  it('quitar el único checkpoint de una ruta activa la deja vacía y se desactiva', () => {
    expect(efectoDeQuitar(ruta(true, 'a'), new Set(['a']))).toEqual({
      vacia: true,
      seDesactiva: true,
    });
  });

  it('quitar uno de varios no la vacía', () => {
    expect(efectoDeQuitar(ruta(true, 'a', 'b'), new Set(['a']))).toEqual({
      vacia: false,
      seDesactiva: false,
    });
  });

  it('una ruta ya inactiva se queda vacía pero no «se desactiva»', () => {
    expect(efectoDeQuitar(ruta(false, 'a'), new Set(['a']))).toEqual({
      vacia: true,
      seDesactiva: false,
    });
  });

  it('un checkpoint repetido en la ruta cuenta como uno', () => {
    expect(efectoDeQuitar(ruta(true, 'a', 'a'), new Set(['a']))).toEqual({
      vacia: true,
      seDesactiva: true,
    });
  });

  it('quitar varios a la vez (un lote) vacía la ruta si se llevan todos', () => {
    expect(efectoDeQuitar(ruta(true, 'a', 'b'), new Set(['a', 'b']))).toEqual({
      vacia: true,
      seDesactiva: true,
    });
  });

  it('sin quitar nada: vacía solo si ya no tiene checkpoints', () => {
    expect(efectoDeQuitar(ruta(true), new Set()).vacia).toBe(true);
    expect(efectoDeQuitar(ruta(true, 'a'), new Set()).vacia).toBe(false);
  });
});

describe('aplicarCambios (los cambios previos del lote, en el orden en que se ejecutan)', () => {
  const quitar = (checkpointId: string): CambioDeCheckpoint => ({ op: 'quitar', checkpointId });
  const anadir = (checkpointId: string): CambioDeCheckpoint => ({ op: 'añadir', checkpointId });
  const ids = (r: { checkpoints: readonly { checkpointId: string }[] }) =>
    r.checkpoints.map((c) => c.checkpointId);

  it('sin cambios, la ruta tal cual', () => {
    const r = ruta(true, 'a', 'b');
    expect(aplicarCambios(r, [])).toEqual(r);
  });

  it('quitar uno previo: el siguiente que quite el último la vacía', () => {
    const tras = aplicarCambios(ruta(true, 'a', 'b'), [quitar('a')]);
    expect(ids(tras)).toEqual(['b']);
    expect(efectoDeQuitar(tras, new Set(['b']))).toEqual({ vacia: true, seDesactiva: true });
  });

  it('añadir antes de quitar el último: no se queda vacía', () => {
    const tras = aplicarCambios(ruta(true, 'a'), [anadir('b')]);
    expect(efectoDeQuitar(tras, new Set(['a']))).toEqual({ vacia: false, seDesactiva: false });
  });

  it('quitar el último y luego añadir: ya se desactivó (añadir no la reactiva)', () => {
    const tras = aplicarCambios(ruta(true, 'a'), [quitar('a'), anadir('b')]);
    expect(tras).toEqual({ isActive: false, checkpoints: [{ checkpointId: 'b' }] });
    // Quitar después el añadido la vacía, pero ya estaba desactivada: no se avisa dos veces.
    expect(efectoDeQuitar(tras, new Set(['b']))).toEqual({ vacia: true, seDesactiva: false });
  });

  it('no muta la ruta de entrada', () => {
    const r = ruta(true, 'a');
    aplicarCambios(r, [quitar('a'), anadir('b')]);
    expect(r).toEqual(ruta(true, 'a'));
  });
});
