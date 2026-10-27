import { describe, it, expect } from 'vitest';
import { explainScan } from './scan-explanation.js';

describe('explainScan', () => {
  it('verified = válido (sin prometer que cuente en la ronda)', () => {
    const r = explainScan({
      validationStatus: 'verified',
      validationReason: null,
      fraudFlags: { flagged: false },
    });
    expect(r.validacion).toBe('válido: es un escaneo auténtico de un punto real');
    expect(r.motivosSospecha).toEqual([]);
  });

  it('pending_review con su motivo traducido', () => {
    const r = explainScan({
      validationStatus: 'pending_review',
      validationReason: 'untyped_scan_on_protected_checkpoint',
      fraudFlags: null,
    });
    expect(r.validacion).toBe(
      'pendiente de revisión: faltaban datos para verificarlo; no se descarta, y hoy no se puede aprobar ni rechazar a mano (motivo: escaneo sin datos de verificación en un checkpoint protegido)'
    );
  });

  it('rejected con su motivo traducido', () => {
    const r = explainScan({
      validationStatus: 'rejected',
      validationReason: 'out_of_radius',
      fraudFlags: null,
    });
    expect(r.validacion).toBe(
      'rechazado: la verificación falló (motivo: fuera de la distancia máxima configurada del checkpoint)'
    );
  });

  it('sig_mismatch es solo firma no válida, sin hablar de clonación', () => {
    const r = explainScan({
      validationStatus: 'rejected',
      validationReason: 'sig_mismatch',
      fraudFlags: null,
    });
    expect(r.validacion).toBe('rechazado: la verificación falló (motivo: firma no válida)');
  });

  it('traduce los motivos de clonación de etiquetas NFC', () => {
    const r = explainScan({
      validationStatus: 'rejected',
      validationReason: 'physical_uid_mismatch',
      fraudFlags: null,
    });
    expect(r.validacion).toMatch(/etiqueta clonada/);
  });

  it('motivo desconocido: el código tal cual', () => {
    const r = explainScan({
      validationStatus: 'rejected',
      validationReason: 'motivo_nuevo_x',
      fraudFlags: null,
    });
    expect(r.validacion).toBe('rechazado: la verificación falló (motivo: motivo_nuevo_x)');
  });

  it('sin estado de validación lo dice, sin inventar', () => {
    expect(
      explainScan({ validationStatus: null, validationReason: null, fraudFlags: null }).validacion
    ).toBe('sin estado de validación');
  });

  it('gpsProximity fallida: GPS más lejos que el radio, severidad media', () => {
    const r = explainScan({
      validationStatus: 'verified',
      validationReason: null,
      fraudFlags: { flagged: true, gpsProximity: { status: 'fail', distance: 120 } },
    });
    expect(r.motivosSospecha).toEqual([
      'el GPS del móvil estaba más lejos del punto que la distancia máxima configurada (severidad media)',
    ]);
    // válido y sospechoso a la vez
    expect(r.validacion).toMatch(/^válido/);
  });

  it('gpsProximity fallida con distancia: la dice (distingue un radio ajustado de un punto mal situado)', () => {
    const r = explainScan({
      validationStatus: 'verified',
      validationReason: null,
      fraudFlags: {
        flagged: true,
        gpsProximity: {
          status: 'fail',
          distanceMeters: 3212.4,
          accuracyMeters: 8.7,
          effectiveDistanceMeters: 3203.7,
        },
      },
    });
    expect(r.motivosSospecha).toEqual([
      'el GPS del móvil estaba más lejos del punto que la distancia máxima configurada (severidad media) (el móvil estaba a 3212 m del punto guardado, con precisión GPS de ±9 m)',
    ]);
  });

  it('undergroundMode fallida: punto subterráneo pero el móvil SÍ tenía cobertura, señal leve', () => {
    const r = explainScan({
      validationStatus: 'verified',
      validationReason: null,
      fraudFlags: { flagged: true, undergroundMode: { status: 'fail' } },
    });
    expect(r.motivosSospecha).toEqual([
      'el punto está marcado como subterráneo, pero el móvil tenía cobertura (wifi o datos móviles), lo que sugiere que no estaba en ese lugar (señal leve) (severidad baja)',
    ]);
  });

  it('patrollerLocationMismatch fallida: ubicación no asignada, severidad alta', () => {
    const r = explainScan({
      validationStatus: 'verified',
      validationReason: null,
      fraudFlags: { flagged: true, patrollerLocationMismatch: { status: 'fail' } },
    });
    expect(r.motivosSospecha).toEqual([
      'el vigilante escaneó en una ubicación a la que no está asignado (severidad alta)',
    ]);
  });

  it('varias reglas fallidas a la vez; las que pasan o se omiten no cuentan', () => {
    const r = explainScan({
      validationStatus: 'verified',
      validationReason: null,
      fraudFlags: {
        flagged: true,
        gpsProximity: { status: 'fail' },
        undergroundMode: { status: 'skipped' },
        patrollerLocationMismatch: { status: 'fail' },
      },
    });
    expect(r.motivosSospecha).toHaveLength(2);
    expect(r.motivosSospecha[0]).toMatch(/GPS del móvil/);
    expect(r.motivosSospecha[1]).toMatch(/no está asignado/);
  });

  it('no sospechoso: sin motivos aunque venga el detalle de reglas', () => {
    const r = explainScan({
      validationStatus: 'verified',
      validationReason: null,
      fraudFlags: { flagged: false, gpsProximity: { status: 'pass' } },
    });
    expect(r.motivosSospecha).toEqual([]);
  });

  it('sospechoso sin regla reconocible: lo dice en vez de dejar hueco para adivinar', () => {
    const r = explainScan({
      validationStatus: 'verified',
      validationReason: null,
      fraudFlags: { flagged: true, reglaNueva: { status: 'fail' } },
    });
    expect(r.motivosSospecha).toEqual(['reglaNueva']);

    const sinDetalle = explainScan({
      validationStatus: 'verified',
      validationReason: null,
      fraudFlags: { flagged: true },
    });
    expect(sinDetalle.motivosSospecha).toEqual(['marcado como sospechoso sin motivo detallado']);
  });
});
