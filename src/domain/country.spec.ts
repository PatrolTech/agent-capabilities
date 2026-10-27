import { describe, it, expect } from 'vitest';
import { FALTA_PAIS, normalizeCountry } from './country.js';

describe('normalizeCountry', () => {
  it('acepta un ISO-2 real en cualquier caja y con espacios', () => {
    expect(normalizeCountry(' mx ')).toBe('MX');
    expect(normalizeCountry('ES')).toBe('ES');
  });

  it('descarta lo que no es un país: vacío, nombres, códigos inventados', () => {
    for (const valor of [undefined, null, '', 'México', 'XX', 'E5']) {
      expect(normalizeCountry(valor)).toBeNull();
    }
  });

  it('el aviso de país pide preguntarlo, sin suponerlo', () => {
    expect(FALTA_PAIS).toMatch(/Pregúntale en qué país/);
    expect(FALTA_PAIS).toMatch(/No supongas el país/);
  });
});
