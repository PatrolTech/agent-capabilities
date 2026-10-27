/**
 * Qué le pasa a una ruta al quitarle checkpoints. Regla del backend: una ruta
 * que se queda sin checkpoints se desactiva (deja de generar rondas) y no se
 * puede volver a activar hasta que tenga alguno. Añadir uno no la reactiva.
 */

export interface RutaConCheckpoints {
  isActive: boolean;
  checkpoints: readonly { checkpointId: string }[];
}

export interface EfectoDeQuitar {
  /** No le queda ningún checkpoint. */
  vacia: boolean;
  /** Estaba activa y se desactiva por quedarse vacía. */
  seDesactiva: boolean;
}

/** El efecto de quitar `quitados` de la ruta (un checkpoint repetido en ella cuenta como uno). */
export function efectoDeQuitar(
  ruta: RutaConCheckpoints,
  quitados: ReadonlySet<string>
): EfectoDeQuitar {
  const vacia = ruta.checkpoints.every((c) => quitados.has(c.checkpointId));
  return { vacia, seDesactiva: vacia && ruta.isActive };
}

/** Un cambio ya propuesto en el lote sobre los checkpoints de una ruta. */
export interface CambioDeCheckpoint {
  op: 'añadir' | 'quitar';
  checkpointId: string;
}

/**
 * La ruta tal como la dejan los cambios previos del lote, aplicados en el orden
 * en que se ejecutarán: con lo añadido, sin lo quitado y desactivada si en algún
 * momento se quedó vacía.
 */
export function aplicarCambios(
  ruta: RutaConCheckpoints,
  cambios: readonly CambioDeCheckpoint[]
): RutaConCheckpoints {
  return cambios.reduce<RutaConCheckpoints>((r, c) => {
    if (c.op === 'añadir')
      return { ...r, checkpoints: [...r.checkpoints, { checkpointId: c.checkpointId }] };
    const { vacia } = efectoDeQuitar(r, new Set([c.checkpointId]));
    return {
      isActive: r.isActive && !vacia,
      checkpoints: r.checkpoints.filter((x) => x.checkpointId !== c.checkpointId),
    };
  }, ruta);
}
