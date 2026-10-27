/**
 * Traduce el estado de validación y las señales antifraude de un escaneo a
 * lenguaje de cliente. Sin esto el modelo solo veía `verified` + `flagged` y
 * decía «sospechoso pero ya verificado» inventándose el motivo. Validación y sospecha son independientes: un escaneo puede
 * ser válido y a la vez sospechoso.
 *
 * Fuente: la validación de escaneos y los tipos de fraude del backend.
 */

// Sin prometer si cuenta o no en la ronda: con Guardia Estricto un válido fuera
// de orden no cuenta, y un rechazado con checkpoint identificado sí la avanza.
const ESTADOS: Record<string, string> = {
  verified: 'válido: es un escaneo auténtico de un punto real',
  pending_review:
    'pendiente de revisión: faltaban datos para verificarlo; no se descarta, y hoy no se puede aprobar ni rechazar a mano',
  rejected: 'rechazado: la verificación falló',
};

/** De vuelta del texto de `validacion` a su estado, para contar (empieza siempre por la palabra del estado). */
export function validationBucket(validacion: string): 'valido' | 'pendiente' | 'rechazado' | null {
  if (validacion.startsWith('válido')) return 'valido';
  if (validacion.startsWith('pendiente')) return 'pendiente';
  if (validacion.startsWith('rechazado')) return 'rechazado';
  return null;
}

const CHIP_CORRUPTO = 'los datos del chip NFC están corruptos';
const CLAVE_CHIP = 'problema interno con la clave criptográfica del chip NFC';

const MOTIVOS: Record<string, string> = {
  checkpoint_not_found: 'la etiqueta o código no está vinculado a ningún checkpoint',
  checkpoint_archived: 'el checkpoint está archivado (dado de baja)',
  untyped_scan_on_protected_checkpoint:
    'escaneo sin datos de verificación en un checkpoint protegido',
  missing_verification_payload: 'faltan los datos de verificación',
  unsupported_verification_type: 'tipo de verificación no soportado',
  no_methods_configured: 'el checkpoint no tiene métodos activos de este tipo',
  method_not_configured: 'el método de verificación no está bien configurado',
  no_matching_method: 'no coincidió con ningún método configurado en el checkpoint',
  invalid_payload: 'datos de verificación inválidos',
  code_mismatch: 'el código no coincide con el del checkpoint',
  invalid_uid: 'el UID de la etiqueta no es válido',
  uid_mismatch: 'el UID de la etiqueta no coincide con el configurado',
  checkpoint_has_no_coords:
    'el checkpoint no tiene coordenadas, así que no se puede comprobar la geocerca',
  out_of_radius: 'fuera de la distancia máxima configurada del checkpoint',
  chip_uid_missing: 'falta el UID del chip NFC',
  chip_not_registered: 'el chip NFC no está registrado',
  chip_does_not_belong_to_checkpoint: 'el chip NFC pertenece a otro checkpoint',
  master_key_unavailable: CLAVE_CHIP,
  key_decryption_failed: CLAVE_CHIP,
  invalid_key: CLAVE_CHIP,
  malformed_picc: CHIP_CORRUPTO,
  malformed_cmac: CHIP_CORRUPTO,
  sig_mismatch: 'firma no válida',
  cmac_mismatch: 'firma anticlonado inválida (posible clonación de la etiqueta)',
  counter_replay: 'se detectó una repetición de un escaneo anterior (anticlonado)',
  physical_uid_mismatch: 'etiqueta clonada: el enlace está grabado en un chip físico distinto',
  physical_uid_required: 'falta el UID físico del chip para comprobar que no está clonado',
};

const REGLAS_FRAUDE: Record<string, string> = {
  gpsProximity:
    'el GPS del móvil estaba más lejos del punto que la distancia máxima configurada (severidad media)',
  // Falla cuando el punto es subterráneo pero el móvil SÍ tenía cobertura.
  undergroundMode:
    'el punto está marcado como subterráneo, pero el móvil tenía cobertura (wifi o datos móviles), lo que sugiere que no estaba en ese lugar (señal leve) (severidad baja)',
  patrollerLocationMismatch:
    'el vigilante escaneó en una ubicación a la que no está asignado (severidad alta)',
};

export interface ScanValidationInput {
  validationStatus: string | null;
  validationReason: string | null;
  fraudFlags: { flagged?: boolean; [regla: string]: unknown } | null;
}

export interface ScanExplanation {
  validacion: string;
  /** Vacío si el escaneo no está marcado como sospechoso. */
  motivosSospecha: string[];
}

function reglaFallida(valor: unknown): boolean {
  return (
    typeof valor === 'object' && valor !== null && (valor as { status?: unknown }).status === 'fail'
  );
}

/**
 * A cuánto estaba el móvil del punto: con unos metros de más, la distancia es
 * demasiado ajustada; con cientos o miles, el punto está mal situado en el mapa.
 */
function distanciaGps(valor: unknown): string {
  const { distanceMeters, accuracyMeters } = valor as {
    distanceMeters?: unknown;
    accuracyMeters?: unknown;
  };
  if (typeof distanceMeters !== 'number') return '';
  const precision =
    typeof accuracyMeters === 'number'
      ? `, con precisión GPS de ±${Math.round(accuracyMeters)} m`
      : '';
  return ` (el móvil estaba a ${Math.round(distanceMeters)} m del punto guardado${precision})`;
}

export function explainScan(scan: ScanValidationInput): ScanExplanation {
  const estado = scan.validationStatus
    ? (ESTADOS[scan.validationStatus] ?? scan.validationStatus)
    : 'sin estado de validación';
  const motivo = scan.validationReason
    ? (MOTIVOS[scan.validationReason] ?? scan.validationReason)
    : null;
  const validacion = motivo ? `${estado} (motivo: ${motivo})` : estado;

  if (scan.fraudFlags?.flagged !== true) return { validacion, motivosSospecha: [] };
  const motivosSospecha = Object.entries(scan.fraudFlags)
    .filter(([regla, valor]) => regla !== 'flagged' && reglaFallida(valor))
    .map(
      ([regla, valor]) =>
        (REGLAS_FRAUDE[regla] ?? regla) + (regla === 'gpsProximity' ? distanciaGps(valor) : '')
    );
  return {
    validacion,
    motivosSospecha:
      motivosSospecha.length > 0
        ? motivosSospecha
        : ['marcado como sospechoso sin motivo detallado'],
  };
}
