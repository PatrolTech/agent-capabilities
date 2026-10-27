import { PatrolTechApiError } from '../../domain/backend-errors.js';
import { segunIdioma, type FixedTextLanguage } from '../../domain/language.js';
import { resolveByName } from '../../domain/resolve-by-name.js';
import type { CheckpointRef, LocationRef } from '../../gateway/index.js';
import { AccionRechazada } from '../names.js';
import type { ActionEnv } from '../types.js';
import { elegirUbicacion } from './elegir-ubicacion.js';

/** Piezas comunes a los ficheros de acciones (checkpoints, rutas, vigilantes, ubicaciones, usuarios…). */

/**
 * Lo que resuelve `preparar` (id de ubicación, identificador del
 * vigilante) viaja en los propios parámetros, que son lo único que guarda la
 * acción pendiente; por eso el modelo ve esos campos. `preparar` los
 * sobrescribe SIEMPRE, así que lo que ponga el modelo no llega al backend.
 */
export const INTERNO = 'Interno: lo rellena el sistema; no lo rellenes ni lo indiques.';

/**
 * Los parámetros de una acción que rellena `preparar` (descritos con `INTERNO`): un canal que
 * construye su propio esquema de entrada (el MCP) los quita, porque el modelo no debe rellenarlos
 * y `preparar` los sobrescribe igualmente.
 */
export function internalParamNames(params: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(params)
    .filter(([, schema]) => (schema as { description?: unknown }).description === INTERNO)
    .map(([name]) => name);
}

/** «Luis Mora (luis@acme.test)», o solo el nombre si no hay email. */
export const quien = (p: { usuario: string; email?: string }): string =>
  `${p.usuario}${p.email ? ` (${p.email})` : ''}`;

/** La persona con ese email (exacto, sin mayúsculas ni espacios alrededor). */
export function buscarPorEmail<T extends { email: string }>(
  usuarios: readonly T[],
  email: string
): T | undefined {
  const buscado = email.trim().toLowerCase();
  return usuarios.find((u) => u.email.trim().toLowerCase() === buscado);
}

/**
 * Al confirmar, una protección que ya no se cumple: «⚠️ No se ha hecho ningún
 * cambio: <motivo>» en el idioma del cliente (queda `failed` sin tocar nada).
 */
export function sinCambios(
  idioma: FixedTextLanguage,
  motivo: Record<FixedTextLanguage, string>
): AccionRechazada {
  return new AccionRechazada(
    segunIdioma(idioma, {
      es: `⚠️ No se ha hecho ningún cambio: ${motivo.es}`,
      en: `⚠️ No changes have been made: ${motivo.en}`,
      fr: `⚠️ Aucune modification n'a été effectuée : ${motivo.fr}`,
    })
  );
}

/**
 * El consejo al modelo cuando la organización está en un límite: con `upsell`
 * (el bot) se le suma ampliar el plan; sin él (MCP), solo las alternativas.
 */
export interface ConsejoDeLimite {
  /** Termina donde el bot añade «o mejorar el plan en Licencia (…)». */
  conPlan: string;
  /** Frase completa, sin plan ni Licencia. */
  sinPlan: string;
}

/**
 * Anticipa el 402 de plazas de gestor (Editor o Admin): el error al modelo con
 * el consejo de quien llama, o null si cabe (o el plan no tiene límite). Sin
 * `upsell`, el límite va con sus números y sin el nombre del plan.
 */
export async function sinPlazaDeGestor(
  { gateway, urls, upsell }: Pick<ActionEnv, 'gateway' | 'urls' | 'upsell'>,
  ctx: { org: { orgId: string }; token: string },
  consejo: ConsejoDeLimite
): Promise<string | null> {
  const plan = await gateway.getPlanUsage(ctx.org.orgId, ctx.token);
  const g = plan.uso?.gestores;
  if (!g || g.limite === null || g.usados < g.limite) return null;
  if (!upsell) {
    return (
      `Ha llegado al límite de gestores (Editor o Admin) de la organización (${g.usados} de ${g.limite}). ` +
      `No lo propongas así: ${consejo.sinPlan}.`
    );
  }
  return (
    `Ha llegado al límite de gestores (Editor o Admin) de su plan ${plan.plan} (${g.usados} de ${g.limite}). No lo propongas así: ` +
    `${consejo.conPlan} o mejorar el plan en Licencia (${urls.license}).`
  );
}

/** Opciones que se le dan al modelo para que pregunte (las demás se cuentan con «y N más»). */
const MAX_OPCIONES = 15;
/** Nombres que se citan en un resumen o un resultado: la confirmación tiene que poder leerse entera. */
const MAX_CITADOS = 10;

/** «A», «B», «C»; con más de `max`, los primeros y «y N más» en el idioma del cliente. */
export function listaCitada(
  nombres: readonly string[],
  idioma: FixedTextLanguage = 'es',
  max = MAX_CITADOS
): string {
  const citados = nombres
    .slice(0, max)
    .map((n) => `«${n}»`)
    .join(', ');
  const resto = nombres.length - max;
  if (resto <= 0) return citados;
  return `${citados} ${segunIdioma(idioma, { es: `y ${resto} más`, en: `and ${resto} more`, fr: `et ${resto} de plus` })}`;
}

/**
 * Aviso, antes de confirmar, de las rutas que se quedarán sin checkpoints y que
 * el backend desactivará. Uno solo para quitar de una ruta y para archivar.
 */
export function avisoRutaVacia(rutas: readonly string[], idioma: FixedTextLanguage): string {
  const nombres = listaCitada(rutas, idioma);
  if (rutas.length === 1) {
    return segunIdioma(idioma, {
      es: `⚠️ La ruta ${nombres} se quedará sin checkpoints y se desactivará: no generará rondas hasta que le añadas checkpoints y la vuelvas a activar.`,
      en: `⚠️ The route ${nombres} will be left without checkpoints and deactivated: it won't generate rounds until you add checkpoints and activate it again.`,
      fr: `⚠️ Le parcours ${nombres} restera sans checkpoints et sera désactivé : il ne générera plus de rondes tant que vous n'y ajouterez pas de checkpoints et ne le réactiverez pas.`,
    });
  }
  return segunIdioma(idioma, {
    es: `⚠️ Las rutas ${nombres} se quedarán sin checkpoints y se desactivarán: no generarán rondas hasta que les añadas checkpoints y las vuelvas a activar.`,
    en: `⚠️ The routes ${nombres} will be left without checkpoints and deactivated: they won't generate rounds until you add checkpoints and activate them again.`,
    fr: `⚠️ Les parcours ${nombres} resteront sans checkpoints et seront désactivés : ils ne généreront plus de rondes tant que vous n'y ajouterez pas de checkpoints et ne les réactiverez pas.`,
  });
}

/**
 * Nombre dicho por el usuario → elemento, o el error con las opciones para que
 * el modelo pregunte («No encuentro el checkpoint «X»…», «Hay varios checkpoints…»).
 */
export function resolver<T>(
  valor: string,
  items: readonly T[],
  nameOf: (item: T) => string,
  [singular, plural]: [string, string],
  opts: { idOf?: (item: T) => string; etiqueta?: (item: T) => string } = {}
): { item: T } | { error: string } {
  const r = resolveByName(valor, items, nameOf, { idOf: opts.idOf });
  if (r.kind === 'found') return { item: r.item };
  const lista = listaCitada(
    (r.kind === 'ambiguous' ? r.matches : items).map(opts.etiqueta ?? nameOf),
    'es',
    MAX_OPCIONES
  );
  if (r.kind === 'ambiguous') {
    return {
      error: `Hay varios ${plural} que casan con «${valor}»: pregunta al usuario cuál (${lista}).`,
    };
  }
  return {
    error: `No encuentro ${singular} «${valor}». ${lista ? `Pregunta al usuario cuál: ${lista}.` : `No hay ${plural}.`}`,
  };
}

/** Íd. con el texto de las acciones de rutas (`entre`: «las rutas»): «No encuentro «X» entre las rutas…». */
export function elegir<T>(
  nombre: string,
  items: readonly T[],
  nameOf: (item: T) => string,
  entre: string
): { item: T } | { error: string } {
  const r = resolveByName(nombre, items, nameOf);
  if (r.kind === 'found') return { item: r.item };
  const opciones = (r.kind === 'ambiguous' ? r.matches : items).map(nameOf);
  const motivo =
    r.kind === 'ambiguous'
      ? `«${nombre}» casa con varios de ${entre}`
      : `No encuentro «${nombre}» entre ${entre}`;
  return {
    error: `${motivo}. Pregunta al usuario cuál${opciones.length ? `: ${listaCitada(opciones, 'es', MAX_OPCIONES)}` : ''}.`,
  };
}

/** Checkpoint por nombre, acotado a una ubicación si la dice (dos pueden llamarse igual en ubicaciones distintas). */
export function resolverCheckpoint(
  items: CheckpointRef[],
  checkpoint: string,
  ubicacion?: string
): { item: CheckpointRef } | { error: string } {
  let candidatos = items;
  if (ubicacion?.trim()) {
    const ubicaciones = [
      ...new Map(
        items.map((c) => [c.locationId, { id: c.locationId, name: c.locationName }])
      ).values(),
    ];
    const u = resolver(ubicacion, ubicaciones, (l) => l.name, ['la ubicación', 'ubicaciones']);
    if ('error' in u) return u;
    candidatos = items.filter((c) => c.locationId === u.item.id);
  }
  return resolver(checkpoint, candidatos, (c) => c.name, ['el checkpoint', 'checkpoints'], {
    etiqueta: (c) => `${c.name} (${c.locationName})`,
  });
}

/** La ubicación dicha por el usuario; sin decirla, la única que tenga. `para` completa «pregúntale en cuál …». */
export function ubicacionPara(
  ubicaciones: LocationRef[],
  nombre: string | undefined,
  para: string
): { item: LocationRef } | { error: string } {
  return elegirUbicacion(ubicaciones, nombre, {
    sinUbicaciones:
      'La organización no tiene ubicaciones: primero hay que crear una en el panel (Ubicaciones).',
    preguntar: (opciones) =>
      `El usuario tiene varias ubicaciones: pregúntale en cuál ${para} (${opciones}).`,
  });
}

/**
 * ¿Pudo el backend aplicar la escritura aunque la respuesta fuera un error?
 * Red, timeout o 5xx: puede que sí (hay que comprobarlo antes de decir que no
 * se hizo nada). Un 4xx es un rechazo: seguro que no.
 */
export function maybeApplied(err: unknown): boolean {
  return !(err instanceof PatrolTechApiError) || err.status >= 500;
}

/**
 * Anticipa el 402/409 de checkpoints del plan (crear y desarchivar cuentan
 * igual): nunca se confirma un cobro extra desde aquí. Devuelve el error al
 * modelo (cada consejo recibe «Ha llegado al límite … (3 de 5)»), o null si
 * cabe. Sin `upsell`, el límite no nombra el plan y se usa `sinPlan`.
 */
export async function sinPlazaDeCheckpoint(
  { gateway, upsell }: Pick<ActionEnv, 'gateway' | 'upsell'>,
  ctx: { org: { orgId: string }; token: string },
  consejo: { conPlan: (alLimite: string) => string; sinPlan: (alLimite: string) => string }
): Promise<string | null> {
  const plan = await gateway.getPlanUsage(ctx.org.orgId, ctx.token);
  const cps = plan.uso?.checkpoints;
  if (!cps || cps.incluidos === null || cps.usados < cps.incluidos) return null;
  if (!upsell) {
    return consejo.sinPlan(
      `Ha llegado al límite de checkpoints de la organización (${cps.usados} de ${cps.incluidos})`
    );
  }
  return consejo.conPlan(
    `Ha llegado al límite de checkpoints de su plan ${plan.plan} (${cps.usados} de ${cps.incluidos})`
  );
}
