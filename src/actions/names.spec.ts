import { describe, it, expect } from 'vitest';
import { isActionEnabled } from './names.js';

describe('isActionEnabled', () => {
  it('sin acciones activas, ninguna está disponible para nadie', () => {
    expect(
      isActionEnabled(
        { botActionsEnabled: [], botActionsAllowlist: [] },
        'create_checkpoint',
        '34600000001'
      )
    ).toBe(false);
  });

  it('solo las acciones activas', () => {
    const flags = { botActionsEnabled: ['create_patroller'] as const, botActionsAllowlist: [] };
    expect(isActionEnabled(flags, 'create_patroller', '34600000001')).toBe(true);
    expect(isActionEnabled(flags, 'create_checkpoint', '34600000001')).toBe(false);
  });

  it('con lista blanca, solo esos teléfonos; vacía, todos', () => {
    const flags = {
      botActionsEnabled: ['create_checkpoint'] as const,
      botActionsAllowlist: ['34600000001'],
    };
    expect(isActionEnabled(flags, 'create_checkpoint', '34600000001')).toBe(true);
    expect(isActionEnabled(flags, 'create_checkpoint', '34600000002')).toBe(false);
  });
});
