import { describe, it, expect } from 'vitest';
import { readHarness } from '../testing/index.js';

describe('consultar_horarios_ruta', () => {
  it('lista los horarios de la ruta en hora LOCAL del cliente, numerados', async () => {
    const { run, gateway } = readHarness({ ctx: { tz: 'America/Bogota' } });
    gateway.routeDetails['r-norte'].timeWindows.push({
      id: 'tw-2',
      startTime: '01:00',
      endTime: '02:00',
      days: [2],
    });

    const out = await run('consultar_horarios_ruta', { ruta: 'Norte' });

    expect(out).toEqual({
      ok: true,
      data: {
        ruta: 'Ruta Norte',
        activa: true,
        zonaHoraria: 'America/Bogota',
        horarios: ['1. lun, mar, mié, jue, vie 13:00-14:00', '2. lun 20:00-21:00'],
      },
    });
  });

  it('ruta que no se puede leer: fallo, no una lista vacía', async () => {
    const { run } = readHarness();
    const out = await run('consultar_horarios_ruta', { ruta: 'Sur' });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('Ruta Sur') as unknown });
  });
});
