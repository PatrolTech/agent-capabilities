/**
 * Lista que el cliente puede haber capado (para no disparar peticiones ni
 * tokens sin límite). `truncado` es la señal honesta de que hay más datos de
 * los devueltos: sin ella el modelo afirmaba totales y ausencias sobre 100 de
 * 3.000 escaneos.
 */
export interface ListaTruncable<T> {
  items: T[];
  /** Total que informa el backend, cuando lo informa. */
  total?: number;
  truncado: boolean;
}
