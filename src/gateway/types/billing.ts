/** Uso frente a los límites del plan. Límite null = sin tope. */
export interface PlanUsage {
  plan: string;
  estadoLicencia: string;
  /**
   * true = la organización ya paga una suscripción. null si no se sabe: el
   * contrato público no lo expone, así que `SdkPatrolTechGateway` siempre da
   * null y quien pide un checkout recibe del backend `ALREADY_SUBSCRIBED`.
   */
  pagaSuscripcion: boolean | null;
  /** null si el backend no pudo calcular el consumo. */
  uso: {
    checkpoints: { usados: number; incluidos: number | null; extraFacturados: number };
    ubicaciones: { usadas: number; limite: number | null };
    gestores: { usados: number; limite: number | null };
  } | null;
}

/**
 * Plan de pago del catálogo (`GET /api/payments/prices`), con los importes ya
 * en la moneda de la organización (la misma con la que cobrará el checkout).
 */
export interface PaidPlan {
  tierId: string;
  nombre: string;
  /** Identificador del tier: `pro` o `business`. */
  identificador: string;
  /** `EUR` o `USD`. */
  moneda: string;
  checkpointsIncluidos: number;
  /** Importes en unidades de la moneda (no céntimos); `extra` es cada checkpoint por encima de los incluidos. */
  mensual: { base: number; extra: number };
  anual: { base: number; extra: number };
}

export type BillingInterval = 'month' | 'year';

/** `POST /api/payments/checkout-session`: a dónde vuelve el cliente al pagar o al cancelar. */
export interface CheckoutLinkInput {
  tierId: string;
  interval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
  /** País ISO-2 del cliente: el backend lo usa para la moneda (manda sobre la IP de quien llama). */
  country?: string | null;
}
