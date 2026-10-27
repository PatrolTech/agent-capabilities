import type { FixedTextLanguage } from './language.js';
import { resolveUrls, type PatrolTechUrls, type TextPolicyOptions } from './urls.js';

/**
 * Respuesta no-2xx del backend de PatrolTech, con su cuerpo para poder
 * distinguir el motivo (`code`). La lanza `SdkPatrolTechClient`; el mensaje es el
 * de siempre, así que quien solo mira `err.message` no nota la diferencia.
 */
export class PatrolTechApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown
  ) {
    super(`PatrolTech API error ${status} en ${path}`);
    this.name = 'PatrolTechApiError';
  }
}

export type BackendErrorKind =
  | 'session_expired'
  | 'forbidden'
  | 'plan_limit'
  | 'extra_checkpoint'
  | 'code_taken'
  | 'checkpoint_archived'
  | 'checkpoint_other_location'
  | 'route_without_checkpoints'
  | 'account_suspended'
  | 'invalid_data'
  | 'not_found'
  | 'policies_pending'
  | 'unavailable';

export interface BackendFailure {
  /** `session_expired` es el único reintentable: una vez, con una sesión nueva. */
  kind: BackendErrorKind;
  mensajeCliente: string;
}

/**
 * Textos al cliente por idioma. `m` es el mensaje del backend (si trae uno) y `precio` el del extra.
 * `dashboard` y `license` son el panel y su página Licencia a los que se deriva al cliente.
 */
const textsFor = ({ dashboard, license }: PatrolTechUrls) =>
  ({
    es: {
      sinCambios: 'No se ha hecho ningún cambio.',
      session_expired: 'Tu sesión con el panel ha caducado y no he podido hacerlo.',
      session_expired_tail: 'Vuelve a pedírmelo.',
      forbidden: 'Tu usuario no tiene permiso para hacer esto en esa organización o ubicación.',
      forbidden_tail: 'Puede hacerlo un administrador de tu cuenta.',
      plan_limit: (m?: string) => m ?? 'Has alcanzado el límite de tu plan.',
      plan_limit_tail: `Puedes ampliar el plan en Licencia: ${license}`,
      plan_limit_users_tail: `Puedes invitarla como Viewer (solo ver), que no ocupa plaza de gestor, o ampliar el plan en Licencia: ${license}`,
      extra_checkpoint: (precio?: string) =>
        `Este checkpoint supera los incluidos en tu plan y añadiría un cargo extra${precio ? ` de ${precio}` : ''}.`,
      extra_checkpoint_tail: `Si quieres añadirlo, créalo desde el panel, donde confirmarás el cargo: ${dashboard}`,
      code_taken: 'Ese código ya lo usa otro checkpoint de tu organización.',
      code_taken_tail: 'Elige otro código o deja que se genere uno automáticamente.',
      checkpoint_archived:
        'Ese checkpoint está archivado y un checkpoint archivado no se puede usar en rutas.',
      checkpoint_archived_tail: 'Si vuelve a estar en servicio, desarchívalo primero.',
      checkpoint_other_location:
        'Ese checkpoint no es de la ubicación de la ruta: una ruta solo lleva checkpoints de su ubicación.',
      route_without_checkpoints:
        'Esa ruta no tiene checkpoints y una ruta sin checkpoints no se puede activar.',
      route_without_checkpoints_tail: 'Añádele checkpoints primero y luego actívala.',
      policies_pending: `Antes de hacer cambios tienes que aceptar las políticas vigentes: entra en el panel (${dashboard}) y acéptalas.`,
      account_suspended: (motivo?: string) => {
        const porque =
          motivo === 'over_plan_limit'
            ? ' porque usa más puntos de control de los que incluye el plan gratuito'
            : motivo === 'unpaid'
              ? ' por un pago pendiente'
              : '';
        return `La cuenta de esa organización está suspendida${porque}.`;
      },
      account_suspended_unpaid: `Un administrador puede reactivarla pagando o actualizando el método de pago en Licencia: ${license}.`,
      account_suspended_over_plan_limit: `Un administrador puede reactivarla eligiendo un plan en Licencia: ${license}, o escríbeme por aquí si prefieres seguir en el plan gratuito.`,
      account_suspended_manual: 'Si crees que es un error, cuéntamelo y lo reviso con el equipo.',
      invalid_data: (m?: string) =>
        `El panel no ha aceptado los datos${m ? `: ${conPunto(m)}` : '.'}`,
      not_found: 'Eso ya no existe en el panel: quizá se borró desde allí.',
      unavailable: 'No he podido completarlo porque el panel no responde ahora mismo.',
      unavailable_tail: 'Inténtalo de nuevo en unos minutos.',
      locale: 'es-ES',
      alAno: 'al año',
      alMes: 'al mes',
    },
    en: {
      sinCambios: 'No changes have been made.',
      session_expired: 'Your dashboard session has expired and I could not do it.',
      session_expired_tail: 'Please ask me again.',
      forbidden: "Your user doesn't have permission to do this in that organization or location.",
      forbidden_tail: 'An administrator of your account can do it.',
      // El mensaje del backend va en español: en inglés se usa el genérico.
      plan_limit: () => "You've reached your plan's limit.",
      plan_limit_tail: `You can upgrade your plan in License: ${license}`,
      plan_limit_users_tail: `You can invite them as a Viewer (view only), which doesn't use a manager seat, or upgrade your plan in License: ${license}`,
      extra_checkpoint: (precio?: string) =>
        `This checkpoint goes beyond the ones included in your plan and would add an extra charge${precio ? ` of ${precio}` : ''}.`,
      extra_checkpoint_tail: `If you want to add it, create it from the dashboard, where you'll confirm the charge: ${dashboard}`,
      code_taken: 'That code is already used by another checkpoint in your organization.',
      code_taken_tail: 'Choose another code or let one be generated automatically.',
      checkpoint_archived:
        'That checkpoint is archived, and an archived checkpoint cannot be used in routes.',
      checkpoint_archived_tail: 'If it is back in service, unarchive it first.',
      checkpoint_other_location:
        "That checkpoint isn't in the route's location: a route only takes checkpoints of its own location.",
      route_without_checkpoints:
        "That route has no checkpoints, and a route without checkpoints can't be activated.",
      route_without_checkpoints_tail: 'Add checkpoints to it first, then activate it.',
      policies_pending: `Before making changes you need to accept the current policies: log in to the dashboard (${dashboard}) and accept them.`,
      account_suspended: (motivo?: string) => {
        const porque =
          motivo === 'over_plan_limit'
            ? ' because it uses more checkpoints than the free plan includes'
            : motivo === 'unpaid'
              ? ' because of a pending payment'
              : '';
        return `That organization's account is suspended${porque}.`;
      },
      account_suspended_unpaid: `An administrator can reactivate it by paying or updating the payment method in License: ${license}.`,
      account_suspended_over_plan_limit: `An administrator can reactivate it by choosing a plan in License: ${license}, or write to me here if you prefer to stay on the free plan.`,
      account_suspended_manual:
        'If you think this is a mistake, tell me and I will review it with the team.',
      invalid_data: (m?: string) =>
        `The dashboard didn't accept the data${m ? `: ${conPunto(m)}` : '.'}`,
      not_found: 'That no longer exists in the dashboard: it may have been deleted there.',
      unavailable: "I couldn't complete it because the dashboard isn't responding right now.",
      unavailable_tail: 'Please try again in a few minutes.',
      locale: 'en-GB',
      alAno: 'per year',
      alMes: 'per month',
    },
    fr: {
      sinCambios: "Aucune modification n'a été effectuée.",
      session_expired: "Votre session sur le tableau de bord a expiré et je n'ai pas pu le faire.",
      session_expired_tail: 'Demandez-le-moi à nouveau.',
      forbidden:
        "Votre utilisateur n'a pas l'autorisation de faire cela dans cette organisation ou ce site.",
      forbidden_tail: 'Un administrateur de votre compte peut le faire.',
      // Igual que en inglés: el mensaje del backend va en español y se usa el genérico.
      plan_limit: () => 'Vous avez atteint la limite de votre forfait.',
      plan_limit_tail: `Vous pouvez changer de forfait dans Licence : ${license}`,
      plan_limit_users_tail: `Vous pouvez inviter cette personne en tant que Viewer (lecture seule), qui n'occupe pas de place de gestionnaire, ou changer de forfait dans Licence : ${license}`,
      extra_checkpoint: (precio?: string) =>
        `Ce checkpoint dépasse ceux inclus dans votre forfait et ajouterait un supplément${precio ? ` de ${precio}` : ''}.`,
      extra_checkpoint_tail: `Si vous voulez l'ajouter, créez-le depuis le tableau de bord, où vous confirmerez le supplément : ${dashboard}`,
      code_taken: 'Ce code est déjà utilisé par un autre checkpoint de votre organisation.',
      code_taken_tail: 'Choisissez un autre code ou laissez-en générer un automatiquement.',
      checkpoint_archived:
        'Ce checkpoint est archivé, et un checkpoint archivé ne peut pas être utilisé dans un parcours.',
      checkpoint_archived_tail: "S'il est de nouveau en service, désarchivez-le d'abord.",
      checkpoint_other_location:
        "Ce checkpoint n'est pas sur le site du parcours : un parcours ne prend que les checkpoints de son site.",
      route_without_checkpoints:
        "Ce parcours n'a pas de checkpoints, et un parcours sans checkpoints ne peut pas être activé.",
      route_without_checkpoints_tail: "Ajoutez-y d'abord des checkpoints, puis activez-le.",
      policies_pending: `Avant de faire des modifications, vous devez accepter les politiques en vigueur : connectez-vous au tableau de bord (${dashboard}) et acceptez-les.`,
      account_suspended: (motivo?: string) => {
        const porque =
          motivo === 'over_plan_limit'
            ? " car elle utilise plus de checkpoints que n'en inclut le forfait gratuit"
            : motivo === 'unpaid'
              ? " en raison d'un paiement en attente"
              : '';
        return `Le compte de cette organisation est suspendu${porque}.`;
      },
      account_suspended_unpaid: `Un administrateur peut le réactiver en payant ou en mettant à jour le moyen de paiement dans Licence : ${license}.`,
      account_suspended_over_plan_limit: `Un administrateur peut le réactiver en choisissant un forfait dans Licence : ${license}, ou écrivez-moi ici si vous préférez rester sur le forfait gratuit.`,
      account_suspended_manual:
        "Si vous pensez qu'il s'agit d'une erreur, dites-le-moi et je vérifierai avec l'équipe.",
      invalid_data: (m?: string) =>
        `Le tableau de bord n'a pas accepté les données${m ? ` : ${conPunto(m)}` : '.'}`,
      not_found:
        "Cela n'existe plus dans le tableau de bord : il a peut-être été supprimé depuis là.",
      unavailable: "Je n'ai pas pu le faire car le tableau de bord ne répond pas pour le moment.",
      unavailable_tail: 'Réessayez dans quelques minutes.',
      locale: 'fr-FR',
      alAno: 'par an',
      alMes: 'par mois',
    },
  }) as const satisfies Record<FixedTextLanguage, unknown>;

/** Recurso del 402 (`LimitExceededResponse.resource` del backend) en cada idioma. */
const RECURSO: Record<FixedTextLanguage, Record<string, string>> = {
  es: { checkpoints: 'checkpoints', locations: 'ubicaciones', users: 'gestores (Editor o Admin)' },
  en: { checkpoints: 'checkpoints', locations: 'locations', users: 'managers (Editor or Admin)' },
  fr: {
    checkpoints: 'checkpoints',
    locations: 'sites',
    users: 'gestionnaires (Editor ou Admin)',
  },
};

/** El límite del 402 tal como lo trae el backend (`limit`, `currentUsage`, `resource`). */
interface Limite {
  limite: number;
  enUso?: number;
  recurso: string;
}

/**
 * Los textos que cambian con `upsell: false` (MCP): los límites con sus números,
 * sin nombres de plan, sin «mejorar el plan» y sin enlaces a Licencia. El mensaje
 * del 402 del backend no se repite (nombra el plan).
 */
const neutralTextsFor = (dashboard: string) =>
  ({
    es: {
      plan_limit: (l?: Limite) =>
        l
          ? `Se ha alcanzado el límite de ${l.recurso} de la organización: ${l.limite}${l.enUso !== undefined ? ` (${l.enUso} en uso)` : ''}.`
          : 'Se ha alcanzado un límite de uso de la organización.',
      plan_limit_users_tail:
        'Puedes invitarla como Viewer (solo ver), que no ocupa plaza de gestor.',
      extra_checkpoint: (precio?: string) =>
        `Este checkpoint supera los incluidos en la organización y añadiría un cargo extra${precio ? ` de ${precio}` : ''}.`,
      account_suspended: (motivo?: string) => {
        const porque =
          motivo === 'over_plan_limit'
            ? ' porque usa más puntos de control de los incluidos'
            : motivo === 'unpaid'
              ? ' por un pago pendiente'
              : '';
        return `La cuenta de esa organización está suspendida${porque}.`;
      },
      account_suspended_tail: `Un administrador puede reactivarla desde el panel: ${dashboard}.`,
    },
    en: {
      plan_limit: (l?: Limite) =>
        l
          ? `The organization has reached its ${l.recurso} limit: ${l.limite}${l.enUso !== undefined ? ` (${l.enUso} in use)` : ''}.`
          : 'The organization has reached a usage limit.',
      plan_limit_users_tail:
        "You can invite them as a Viewer (view only), which doesn't use a manager seat.",
      extra_checkpoint: (precio?: string) =>
        `This checkpoint goes beyond the ones included for the organization and would add an extra charge${precio ? ` of ${precio}` : ''}.`,
      account_suspended: (motivo?: string) => {
        const porque =
          motivo === 'over_plan_limit'
            ? ' because it uses more checkpoints than are included'
            : motivo === 'unpaid'
              ? ' because of a pending payment'
              : '';
        return `That organization's account is suspended${porque}.`;
      },
      account_suspended_tail: `An administrator can reactivate it from the dashboard: ${dashboard}.`,
    },
    fr: {
      plan_limit: (l?: Limite) =>
        l
          ? `L'organisation a atteint sa limite de ${l.recurso} : ${l.limite}${l.enUso !== undefined ? ` (${l.enUso} utilisés)` : ''}.`
          : "L'organisation a atteint une limite d'utilisation.",
      plan_limit_users_tail:
        "Vous pouvez inviter cette personne en tant que Viewer (lecture seule), qui n'occupe pas de place de gestionnaire.",
      extra_checkpoint: (precio?: string) =>
        `Ce checkpoint dépasse ceux inclus pour l'organisation et ajouterait un supplément${precio ? ` de ${precio}` : ''}.`,
      account_suspended: (motivo?: string) => {
        const porque =
          motivo === 'over_plan_limit'
            ? ' car elle utilise plus de checkpoints que ceux inclus'
            : motivo === 'unpaid'
              ? " en raison d'un paiement en attente"
              : '';
        return `Le compte de cette organisation est suspendu${porque}.`;
      },
      account_suspended_tail: `Un administrateur peut le réactiver depuis le tableau de bord : ${dashboard}.`,
    },
  }) as const satisfies Record<FixedTextLanguage, unknown>;

function limiteDel402(body: unknown, idioma: FixedTextLanguage): Limite | undefined {
  const limite = field(body, 'limit');
  if (typeof limite !== 'number') return undefined;
  const enUso = field(body, 'currentUsage');
  const resource = text(field(body, 'resource')) ?? 'checkpoints';
  return {
    limite,
    enUso: typeof enUso === 'number' ? enUso : undefined,
    recurso: RECURSO[idioma][resource] ?? RECURSO[idioma].checkpoints,
  };
}

/** Opciones de `translateBackendError`: la política de textos y si el fallo es de una lectura. */
export interface TranslateErrorOptions extends TextPolicyOptions {
  /** `read`: sin «No se ha hecho ningún cambio». Por defecto, `action`. */
  operation?: 'read' | 'action';
}

/**
 * Traduce un fallo al llamar al backend a lo que se le dice al cliente, en su
 * idioma (`es`, `en` o `fr`, ver `fixedTextLanguage`). Acepta cualquier cosa
 * capturada: lo que no es un `PatrolTechApiError` (timeout, red) es `unavailable`.
 * `opts.urls` son los enlaces a los que se deriva al cliente (por defecto, los de producción) y
 * `opts.upsell: false` quita el plan y la Licencia de los límites (402, 409 de extra, 423) y
 * `opts.operation: 'read'` quita «No se ha hecho ningún cambio» (una lectura nunca cambia nada).
 *
 * Forma del cuerpo de error del backend: los errores con `apiErrorBody` llevan
 * `code` y `message` en primer nivel (402 de límite, 409 de extra y de código);
 * el resto pasa por el envelope global, que deja `message` arriba (o «Error» si
 * no había) y mete el cuerpo original en `meta` (401 `TOKEN_EXPIRED`, 451 de
 * políticas, 400 `VALIDATION_ERROR` con su `error.message`).
 */
export function translateBackendError(
  err: unknown,
  idioma: FixedTextLanguage = 'es',
  opts: TranslateErrorOptions = {}
): BackendFailure {
  const urls = resolveUrls(opts.urls);
  const t = textsFor(urls)[idioma];
  const neutral = opts.upsell === false ? neutralTextsFor(urls.dashboard)[idioma] : undefined;
  // En una lectura no hay cambios que negar: la frase sobra (y despista).
  const sinCambios = opts.operation === 'read' ? '' : t.sinCambios;
  const say = (kind: BackendErrorKind, ...parts: string[]): BackendFailure => ({
    kind,
    mensajeCliente: parts.filter((part) => part.length > 0).join(' '),
  });
  const unavailable = () => say('unavailable', t.unavailable, sinCambios, t.unavailable_tail);
  if (!(err instanceof PatrolTechApiError)) return unavailable();
  const { status } = err;
  const { code, message, reason } = readErrorBody(err.body);

  if (status === 401)
    return say('session_expired', t.session_expired, sinCambios, t.session_expired_tail);
  if (status === 403) return say('forbidden', t.forbidden, sinCambios, t.forbidden_tail);
  if (status === 402) {
    // Sin asientos de gestor (invitar a un Editor o Admin): un Viewer no ocupa plaza.
    const deGestores = code === 'USER_LIMIT_REACHED';
    if (neutral) {
      const limite = neutral.plan_limit(limiteDel402(err.body, idioma));
      const tail = deGestores ? [neutral.plan_limit_users_tail] : [];
      return say('plan_limit', limite, sinCambios, ...tail);
    }
    const tail = deGestores ? t.plan_limit_users_tail : t.plan_limit_tail;
    return say('plan_limit', t.plan_limit(message), sinCambios, tail);
  }
  if (status === 409 && code === 'EXTRA_CHECKPOINT_CONFIRMATION_REQUIRED') {
    // Nunca se confirma el cobro desde el bot (`confirmExtraBilling`): se deriva al panel.
    const precio = extraPrice(err.body, t);
    return say(
      'extra_checkpoint',
      neutral ? neutral.extra_checkpoint(precio) : t.extra_checkpoint(precio),
      sinCambios,
      t.extra_checkpoint_tail
    );
  }
  if (status === 409 && code === 'VERIFICATION_CODE_TAKEN')
    return say('code_taken', t.code_taken, sinCambios, t.code_taken_tail);
  // Rutas: el checkpoint se archivó o no es del sitio entre proponer y confirmar (el mensaje del backend va en inglés).
  if (status === 400 && code === 'CHECKPOINT_ARCHIVED') {
    return say(
      'checkpoint_archived',
      t.checkpoint_archived,
      sinCambios,
      t.checkpoint_archived_tail
    );
  }
  if (status === 400 && code === 'CHECKPOINT_NOT_IN_ROUTE_LOCATION') {
    return say('checkpoint_other_location', t.checkpoint_other_location, sinCambios);
  }
  // Activar una ruta sin checkpoints (se ha vaciado entre proponer y confirmar, o la crea vacía otro camino).
  if (status === 400 && code === 'ROUTE_HAS_NO_CHECKPOINTS') {
    return say(
      'route_without_checkpoints',
      t.route_without_checkpoints,
      sinCambios,
      t.route_without_checkpoints_tail
    );
  }
  if (status === 423 && code === 'ORGANIZATION_SUSPENDED') {
    if (neutral) {
      const conPago = reason === 'unpaid' || reason === 'over_plan_limit';
      const tail = conPago ? neutral.account_suspended_tail : t.account_suspended_manual;
      return say('account_suspended', neutral.account_suspended(reason), sinCambios, tail);
    }
    const tail =
      reason === 'unpaid'
        ? t.account_suspended_unpaid
        : reason === 'over_plan_limit'
          ? t.account_suspended_over_plan_limit
          : t.account_suspended_manual;
    return say('account_suspended', t.account_suspended(reason), sinCambios, tail);
  }
  if (status === 451) return say('policies_pending', t.policies_pending, sinCambios);
  // 404: se borró (desde el panel o en otra conversación) entre proponer y confirmar.
  if (status === 404) return say('not_found', t.not_found, sinCambios);
  // El mensaje del backend solo se repite en español y si se entiende: en inglés y francés (va en
  // español o es técnico) y los internos («unique_user_role_scope already exists») van con el genérico.
  const legible =
    idioma === 'es' && message && !MENSAJE_TECNICO_RE.test(message) ? message : undefined;
  if (status >= 400 && status < 500)
    return say('invalid_data', t.invalid_data(legible), sinCambios);
  return unavailable();
}

/**
 * `translateBackendError` para quien EJECUTA una acción confirmada en un canal
 * sin upsell (el MCP): el rechazo del backend en el idioma del cliente, con los
 * límites en números y sin nombres de plan ni enlaces a Licencia.
 */
export function translateActionError(
  err: unknown,
  language: FixedTextLanguage,
  urls?: Partial<PatrolTechUrls>
): BackendFailure {
  return translateBackendError(err, language, { urls, upsell: false });
}

/** Mensajes del backend que no son para el cliente: restricciones de la BD, validación genérica, inglés técnico. */
const MENSAJE_TECNICO_RE =
  /already exists|validation failed|constraint|violat|sequelize|duplicate key|not found|\w+_\w+/i;

/** El mensaje del backend termina en punto para que no se pegue con «No se ha hecho ningún cambio.». */
function conPunto(m: string): string {
  return /[.!?…]$/.test(m) ? m : `${m}.`;
}

function field(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function readErrorBody(body: unknown): { code?: string; message?: string; reason?: string } {
  const meta = field(body, 'meta');
  // El 423 de suspensión lleva `code` y `reason` dentro de `data`.
  const data = field(body, 'data');
  const code =
    text(field(body, 'code')) ??
    text(field(data, 'code')) ??
    text(field(meta, 'code')) ??
    text(field(field(meta, 'error'), 'code'));
  const reason = text(field(data, 'reason'));
  // «Error» es lo que pone el envelope cuando el cuerpo original no traía mensaje.
  const top = text(field(body, 'message'));
  const message =
    (top !== 'Error' ? top : undefined) ?? text(field(field(meta, 'error'), 'message'));
  return { code, message, reason };
}

/** El `code` con el que el backend explica un rechazo, esté donde esté en el cuerpo. */
export function backendErrorCode(err: PatrolTechApiError): string | undefined {
  return readErrorBody(err.body).code;
}

/** `extraPrice` del 409: importe en céntimos, moneda e intervalo en que se cobra. */
function extraPrice(
  body: unknown,
  t: { locale: string; alAno: string; alMes: string }
): string | undefined {
  const p = field(body, 'extraPrice');
  const amount = field(p, 'amount');
  const currency = text(field(p, 'currency'));
  const interval = field(p, 'interval');
  if (typeof amount !== 'number' || !currency) return undefined;
  const importe = new Intl.NumberFormat(t.locale, { style: 'currency', currency }).format(
    amount / 100
  );
  return `${importe} ${interval === 'year' ? t.alAno : t.alMes}`;
}

/**
 * ¿El backend rechazó porque la App (Incidencias, Control de Acceso) no está
 * activa en la organización? `requireFeature` responde 403 «Feature '<key>' is
 * not enabled for this organization»: no es falta de permiso del usuario.
 */
export function isFeatureDisabled(err: unknown): boolean {
  return (
    err instanceof PatrolTechApiError &&
    err.status === 403 &&
    /is not enabled/i.test(readErrorBody(err.body).message ?? '')
  );
}
