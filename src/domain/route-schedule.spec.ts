import { describe, it, expect } from 'vitest';
import {
  buscarSolape,
  describirHorario,
  elegirHorario,
  expandirFranja,
  horarioALocal,
  horarioAUtc,
  horariosParaBackend,
  listarHorarios,
  MAX_HORARIOS_POR_RUTA,
  type Horario,
} from './route-schedule.js';
import { utcOffsetMinutes } from './timezone.js';

const LV = ['lun', 'mar', 'mie', 'jue', 'vie'] as const;
const BOGOTA = -300; // UTC-5, sin cambio de hora
const MADRID_VERANO = 120; // UTC+2

describe('utcOffsetMinutes (el desfase depende de la fecha: cambio de hora)', () => {
  it('Madrid: +120 en verano y +60 en invierno; Bogotá: -300 siempre', () => {
    expect(utcOffsetMinutes('Europe/Madrid', new Date('2026-07-15T12:00:00Z'))).toBe(120);
    expect(utcOffsetMinutes('Europe/Madrid', new Date('2026-01-15T12:00:00Z'))).toBe(60);
    expect(utcOffsetMinutes('America/Bogota', new Date('2026-07-15T12:00:00Z'))).toBe(-300);
    // Justo después del cambio de octubre (25-10-2026 01:00 UTC) ya es invierno.
    expect(utcOffsetMinutes('Europe/Madrid', new Date('2026-10-25T00:59:00Z'))).toBe(120);
    expect(utcOffsetMinutes('Europe/Madrid', new Date('2026-10-25T01:00:00Z'))).toBe(60);
  });
});

describe('local → UTC con días desplazados', () => {
  const noche: Horario = { startTime: '20:00', endTime: '05:00', days: [1, 2, 3, 4, 5] };

  it('20:00-05:00 de lun a vie en UTC-5: empieza a la 01:00 UTC del día siguiente (mar a sáb)', () => {
    expect(horarioAUtc(noche, BOGOTA)).toEqual({
      startTime: '01:00',
      endTime: '10:00',
      days: [2, 3, 4, 5, 6],
    });
  });

  it('20:00-05:00 de lun a vie en UTC+2: 18:00-03:00 UTC, mismos días', () => {
    expect(horarioAUtc(noche, MADRID_VERANO)).toEqual({
      startTime: '18:00',
      endTime: '03:00',
      days: [1, 2, 3, 4, 5],
    });
  });

  it('el mismo horario en Madrid cambia de hora UTC con el cambio de hora (invierno: 19:00)', () => {
    const invierno = utcOffsetMinutes('Europe/Madrid', new Date('2026-01-15T12:00:00Z'));
    expect(horarioAUtc(noche, invierno)).toEqual({
      startTime: '19:00',
      endTime: '04:00',
      days: [1, 2, 3, 4, 5],
    });
  });

  it('domingo → lunes al avanzar y lunes → domingo al retroceder', () => {
    expect(horarioAUtc({ startTime: '22:00', endTime: '23:00', days: [7] }, BOGOTA)).toEqual({
      startTime: '03:00',
      endTime: '04:00',
      days: [1],
    });
    expect(horarioAUtc({ startTime: '01:00', endTime: '02:00', days: [1] }, MADRID_VERANO)).toEqual(
      { startTime: '23:00', endTime: '00:00', days: [7] }
    );
  });

  it('ida y vuelta: UTC → local devuelve el horario original', () => {
    for (const offset of [BOGOTA, MADRID_VERANO, 60, -180]) {
      expect(horarioALocal(horarioAUtc(noche, offset), offset)).toEqual(noche);
    }
  });
});

describe('expandirFranja', () => {
  it('sin repetición: un solo horario', () => {
    expect(expandirFranja({ dias: ['vie', 'lun'], desde: '08:00', hasta: '09:30' })).toEqual([
      { startTime: '08:00', endTime: '09:30', days: [1, 5] },
    ]);
  });

  it('«de lunes a viernes de 20:00 a 05:00 cada hora»: 9 horarios; los de después de medianoche, de martes a sábado', () => {
    const r = expandirFranja({ dias: LV, desde: '20:00', hasta: '05:00', repetir_cada_min: 60 });
    expect(r).toEqual([
      { startTime: '20:00', endTime: '21:00', days: [1, 2, 3, 4, 5] },
      { startTime: '21:00', endTime: '22:00', days: [1, 2, 3, 4, 5] },
      { startTime: '22:00', endTime: '23:00', days: [1, 2, 3, 4, 5] },
      { startTime: '23:00', endTime: '00:00', days: [1, 2, 3, 4, 5] },
      { startTime: '00:00', endTime: '01:00', days: [2, 3, 4, 5, 6] },
      { startTime: '01:00', endTime: '02:00', days: [2, 3, 4, 5, 6] },
      { startTime: '02:00', endTime: '03:00', days: [2, 3, 4, 5, 6] },
      { startTime: '03:00', endTime: '04:00', days: [2, 3, 4, 5, 6] },
      { startTime: '04:00', endTime: '05:00', days: [2, 3, 4, 5, 6] },
    ]);
  });

  it('el último trozo se recorta a la hora de fin; el domingo pasa a lunes', () => {
    expect(
      expandirFranja({ dias: ['dom'], desde: '23:00', hasta: '00:30', repetir_cada_min: 60 })
    ).toEqual([
      { startTime: '23:00', endTime: '00:00', days: [7] },
      { startTime: '00:00', endTime: '00:30', days: [1] },
    ]);
  });

  it('rechaza desde = hasta y repeticiones de menos de 5 minutos', () => {
    expect(expandirFranja({ dias: ['lun'], desde: '10:00', hasta: '10:00' })).toHaveProperty(
      'error'
    );
    expect(
      expandirFranja({ dias: ['lun'], desde: '10:00', hasta: '11:00', repetir_cada_min: 2 })
    ).toHaveProperty('error');
  });
});

describe('buscarSolape (regla del backend)', () => {
  it('contiguos no se solapan; compartir un minuto sí', () => {
    expect(
      buscarSolape([
        { startTime: '20:00', endTime: '21:00', days: [1] },
        { startTime: '21:00', endTime: '22:00', days: [1] },
      ])
    ).toBeNull();
    expect(
      buscarSolape([
        { startTime: '20:00', endTime: '21:00', days: [1] },
        { startTime: '20:59', endTime: '22:00', days: [1] },
      ])
    ).toEqual([0, 1]);
  });

  it('el que cruza medianoche choca con el del día siguiente, y el domingo con el lunes', () => {
    expect(
      buscarSolape([
        { startTime: '23:00', endTime: '01:00', days: [1] },
        { startTime: '00:30', endTime: '02:00', days: [2] },
      ])
    ).toEqual([0, 1]);
    expect(
      buscarSolape([
        { startTime: '23:00', endTime: '01:00', days: [7] },
        { startTime: '00:30', endTime: '02:00', days: [1] },
      ])
    ).toEqual([0, 1]);
    expect(
      buscarSolape([
        { startTime: '23:00', endTime: '01:00', days: [1] },
        { startTime: '00:30', endTime: '02:00', days: [1] },
      ])
    ).toBeNull();
  });
});

describe('horariosParaBackend', () => {
  it('turno de noche en UTC-5: 9 horarios UTC sin solapes', () => {
    const r = horariosParaBackend(
      [{ dias: LV, desde: '20:00', hasta: '05:00', repetir_cada_min: 60 }],
      BOGOTA
    );
    if ('error' in r) throw new Error(r.error);
    expect(r).toHaveLength(9);
    expect(r[0]).toEqual({ startTime: '01:00', endTime: '02:00', days: [2, 3, 4, 5, 6] });
    expect(r[8]).toEqual({ startTime: '09:00', endTime: '10:00', days: [2, 3, 4, 5, 6] });
  });

  it('detecta el solape entre franjas nuevas y con las que ya tiene la ruta, en hora del cliente', () => {
    const entre = horariosParaBackend(
      [
        { dias: ['lun'], desde: '20:00', hasta: '22:00' },
        { dias: ['lun'], desde: '21:00', hasta: '23:00' },
      ],
      MADRID_VERANO
    );
    expect(entre).toEqual({
      error: expect.stringContaining(
        '«lun 20:00-22:00» se solapa con el horario «lun 21:00-23:00»'
      ),
    });

    const existente = { startTime: '18:00', endTime: '19:00', days: [1] }; // lun 20:00-21:00 en Madrid verano
    const conExistente = horariosParaBackend(
      [{ dias: ['lun'], desde: '20:30', hasta: '21:30' }],
      MADRID_VERANO,
      [existente]
    );
    expect(conExistente).toEqual({
      error: expect.stringContaining('el horario que ya tiene la ruta «lun 20:00-21:00»'),
    });
  });

  it(`no pasa de ${MAX_HORARIOS_POR_RUTA} horarios por ruta`, () => {
    const todaLaSemana = {
      dias: ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const,
      desde: '00:00',
      hasta: '23:59',
      repetir_cada_min: 5,
    };
    expect(horariosParaBackend([todaLaSemana], 0)).toEqual({
      error: expect.stringContaining(`máximo ${MAX_HORARIOS_POR_RUTA}`),
    });
  });
});

describe('listar y elegir horarios (para borrar)', () => {
  const utc = [
    { id: 'b', startTime: '02:00', endTime: '03:00', days: [2] }, // lun 21:00-22:00 en UTC-5
    { id: 'a', startTime: '01:00', endTime: '02:00', days: [2, 3] }, // lun, mar 20:00-21:00
    { id: 'c', startTime: '14:00', endTime: '15:00', days: [2] }, // mar 09:00-10:00
  ];
  const lista = listarHorarios(utc, BOGOTA);

  it('en hora local y ordenados por día y hora', () => {
    expect(lista.map((h) => [h.id, h.texto])).toEqual([
      ['a', 'lun, mar 20:00-21:00'],
      ['b', 'lun 21:00-22:00'],
      ['c', 'mar 09:00-10:00'],
    ]);
  });

  it('por número, por horas o por día y horas', () => {
    expect(elegirHorario(lista, '2')).toEqual({ item: lista[1] });
    expect(elegirHorario(lista, 'el de 21:00 a 22:00')).toEqual({ item: lista[1] });
    expect(elegirHorario(lista, 'martes 9:00-10:00')).toEqual({ item: lista[2] });
  });

  it('ambiguo o inexistente: error con la lista numerada', () => {
    const ambiguo = elegirHorario(
      listarHorarios(
        [...utc, { id: 'd', startTime: '01:00', endTime: '02:00', days: [5] }],
        BOGOTA
      ),
      '20:00-21:00'
    );
    expect(ambiguo).toEqual({ error: expect.stringContaining('1. lun, mar 20:00-21:00') });
    expect(elegirHorario(lista, '9')).toHaveProperty('error');
    expect(elegirHorario(lista, 'el de la noche')).toHaveProperty('error');
  });

  it('describirHorario en inglés', () => {
    expect(describirHorario({ startTime: '20:00', endTime: '21:00', days: [6, 7] }, 'en')).toBe(
      'Sat, Sun 20:00-21:00'
    );
  });
});
