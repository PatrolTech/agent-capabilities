import { describe, it, expect } from 'vitest';
import { importe } from './money.js';

describe('importe', () => {
  it('formatea como el panel, sin decimales si no los hay y con espacio normal', () => {
    expect(importe(11, 'EUR')).toBe('11 €');
    expect(importe(250, 'USD')).toBe('250 US$');
    expect(importe(2.5, 'EUR')).toBe('2,5 €');
    expect(importe(11, 'EUR')).not.toContain('\u00a0');
  });
});
