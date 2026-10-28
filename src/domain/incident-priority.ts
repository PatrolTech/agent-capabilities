/**
 * Prioridades de una incidencia (códigos de la API) con su nombre en el panel y en los
 * parámetros/campos en inglés del canal MCP. Interno: no se exporta desde el paquete.
 */
export const INCIDENT_PRIORITIES = {
  LOW: { es: 'Baja', en: 'low' },
  MEDIUM: { es: 'Media', en: 'medium' },
  HIGH: { es: 'Alta', en: 'high' },
  CRITICAL: { es: 'Crítica', en: 'critical' },
} as const satisfies Record<string, { es: string; en: string }>;

/** El nombre en el panel de una prioridad, o el código tal cual si es otro. */
export function incidentPriorityLabel(code: string): string {
  return (INCIDENT_PRIORITIES as Record<string, { es: string } | undefined>)[code]?.es ?? code;
}
