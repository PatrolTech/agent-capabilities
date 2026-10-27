/** «11 €», «250 US$» (con espacio normal: Intl pone uno duro). */
export function importe(valor: number, moneda: string): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
    .format(valor)
    .replace(/\u00a0/g, ' ');
}
