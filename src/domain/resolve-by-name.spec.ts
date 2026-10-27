import { describe, it, expect } from 'vitest';
import { resolveByName } from './resolve-by-name.js';

interface Item {
  id: string;
  name: string;
}

const madrid: Item = { id: 'm', name: 'Vigilancia Madrid' };
const barcelona: Item = { id: 'b', name: 'Vigilancia Barcelona' };
const dos: Item = { id: 'd', name: '2' };

const nameOf = (i: Item) => i.name;

describe('resolveByName', () => {
  it('cadena vacía o en blanco -> no resuelto (nunca el primero)', () => {
    expect(resolveByName('', [madrid, barcelona], nameOf)).toEqual({ kind: 'none' });
    expect(resolveByName('   ', [madrid, barcelona], nameOf)).toEqual({ kind: 'none' });
  });

  it('exacto case-insensitive', () => {
    expect(resolveByName('vigilancia madrid', [madrid, barcelona], nameOf)).toEqual({
      kind: 'found',
      item: madrid,
    });
  });

  it('substring único', () => {
    expect(resolveByName('barce', [madrid, barcelona], nameOf)).toEqual({
      kind: 'found',
      item: barcelona,
    });
  });

  it('substring con más de una coincidencia -> ambiguo con los candidatos', () => {
    expect(resolveByName('vigilancia', [madrid, barcelona], nameOf)).toEqual({
      kind: 'ambiguous',
      matches: [madrid, barcelona],
    });
  });

  it('índice 1-based cuando se pide, y fuera de rango -> no resuelto', () => {
    expect(resolveByName('2', [madrid, barcelona], nameOf, { byIndex: true })).toEqual({
      kind: 'found',
      item: barcelona,
    });
    expect(resolveByName('3', [madrid, barcelona], nameOf, { byIndex: true })).toEqual({
      kind: 'none',
    });
  });

  it('un índice fuera de rango NO corta: sigue probando el substring', () => {
    const ronda2024: Item = { id: 'r24', name: 'Ronda 2024' };
    expect(resolveByName('2024', [madrid, ronda2024], nameOf, { byIndex: true })).toEqual({
      kind: 'found',
      item: ronda2024,
    });
  });

  it('el nombre exacto gana al índice: una organización llamada "2" es alcanzable (M2)', () => {
    expect(resolveByName('2', [madrid, dos], nameOf, { byIndex: true })).toEqual({
      kind: 'found',
      item: dos,
    });
  });

  it('sin byIndex, un número no se interpreta como índice', () => {
    expect(resolveByName('2', [madrid, barcelona], nameOf)).toEqual({ kind: 'none' });
  });

  it('resuelve por id exacto cuando el llamador lo permite', () => {
    expect(resolveByName('b', [madrid, barcelona], nameOf, { idOf: (i) => i.id })).toEqual({
      kind: 'found',
      item: barcelona,
    });
  });

  it('un id que no está en la lista no resuelve (invariante anti-fuga entre organizaciones)', () => {
    expect(
      resolveByName('org-de-otro', [madrid, barcelona], nameOf, { idOf: (i) => i.id })
    ).toEqual({ kind: 'none' });
  });

  it('lista vacía -> no resuelto', () => {
    expect(resolveByName('lo que sea', [], nameOf)).toEqual({ kind: 'none' });
  });
});

describe('resolveByName: tildes y espacios (como escriben por WhatsApp)', () => {
  const items = [{ name: 'Almacén Norte' }, { name: 'Recepción' }];
  it('sin tildes, en mayúsculas o con espacios de más casa igual (exacto y substring)', () => {
    expect(resolveByName('almacen norte', items, (i) => i.name)).toEqual({
      kind: 'found',
      item: items[0],
    });
    expect(resolveByName('  ALMACEN   NORTE ', items, (i) => i.name)).toEqual({
      kind: 'found',
      item: items[0],
    });
    expect(resolveByName('recepcion', items, (i) => i.name)).toEqual({
      kind: 'found',
      item: items[1],
    });
    expect(resolveByName('almacén', items, (i) => i.name)).toEqual({
      kind: 'found',
      item: items[0],
    });
  });
  it('«José» y «Jose» son el mismo nombre: dos así quedan ambiguos', () => {
    const p = [{ name: 'José' }, { name: 'Jose' }];
    expect(resolveByName('jose', p, (i) => i.name).kind).toBe('ambiguous');
  });
});
