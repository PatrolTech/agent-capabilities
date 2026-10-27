import { normalizeName, resolveByName } from '../../domain/resolve-by-name.js';
import type { LocationRef } from '../../gateway/index.js';

const MAX_OPCIONES = 15;

/**
 * La ubicación dicha por el usuario, entre las de la organización (la comparten
 * las acciones que crean checkpoints y rutas y las de ubicaciones e invitar). Sin
 * decirla, la única que tenga si `unicaPorDefecto`.
 *
 * Dos ubicaciones con el mismo nombre solo se distinguen por su dirección y su
 * número (el que acepta `resolveByName` con `byIndex`): sin ellos, el cliente no
 * podía elegir y la conversación se quedaba en bucle.
 */
export function elegirUbicacion(
  ubicaciones: readonly LocationRef[],
  nombre: string | undefined,
  opts: {
    /** Error con la organización sin ubicaciones. */
    sinUbicaciones: string;
    /** Error cuando no la dice y hay varias, con las opciones ya formateadas. */
    preguntar: (opciones: string) => string;
    unicaPorDefecto?: boolean;
  }
): { item: LocationRef } | { error: string } {
  if (ubicaciones.length === 0) return { error: opts.sinUbicaciones };
  const repetidos =
    new Set(ubicaciones.map((l) => normalizeName(l.name))).size < ubicaciones.length;
  const opciones =
    ubicaciones
      .slice(0, MAX_OPCIONES)
      .map((l, i) =>
        repetidos ? `${i + 1}. «${l.name}»${l.address ? ` (${l.address})` : ''}` : `«${l.name}»`
      )
      .join(', ') + (repetidos ? ' (si elige una repetida, pasa su número en `ubicacion`)' : '');
  if (nombre?.trim()) {
    const r = resolveByName(nombre, ubicaciones, (l) => l.name, { byIndex: repetidos });
    if (r.kind === 'found') return { item: r.item };
    const motivo =
      r.kind === 'ambiguous' ? 'Hay varias ubicaciones que casan con' : 'No encuentro la ubicación';
    return { error: `${motivo} «${nombre}». Pregunta al usuario cuál: ${opciones}.` };
  }
  if ((opts.unicaPorDefecto ?? true) && ubicaciones.length === 1) return { item: ubicaciones[0] };
  return { error: opts.preguntar(opciones) };
}

/**
 * `elegirUbicacion` con los textos de ubicaciones e invitar. Sin decirla, la
 * única solo si `unicaPorDefecto` (nunca para borrar ni acotar una invitación).
 */
export function ubicacionPedida(
  ubicaciones: readonly LocationRef[],
  nombre: string | undefined,
  para: string,
  unicaPorDefecto = true
): { item: LocationRef } | { error: string } {
  return elegirUbicacion(ubicaciones, nombre, {
    sinUbicaciones: 'La organización no tiene ubicaciones.',
    preguntar: (opciones) => `Pregunta al usuario qué ubicación quiere ${para}: ${opciones}.`,
    unicaPorDefecto,
  });
}
