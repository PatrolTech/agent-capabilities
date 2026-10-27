/**
 * Idioma BASE de un locale (`es_MX` → `es`, `en-US` → `en`).
 *
 * Hay canales que solo tienen textos por idioma base: se normaliza al guardar el
 * idioma del contacto y al usarlo, para que el que se guarda y el que se usa sean
 * el mismo.
 */
export function baseLanguage(language: string): string {
  return language.split(/[-_]/)[0].toLowerCase();
}

export type ReplyLanguage = 'es' | 'en' | 'fr';

const SUPPORTED: readonly ReplyLanguage[] = ['es', 'en', 'fr'];

// Palabras funcionales frecuentes y fórmulas de cortesía. Las que comparten dos
// idiomas ("de", "la", "que", "no") puntúan en ambos y no deshacen empates.
// "a" se deja fuera: es artículo en inglés, preposición en español y verbo en francés.
const FUNCTION_WORDS: Record<ReplyLanguage, ReadonlySet<string>> = {
  es: new Set(
    (
      'el la los las un una unos unas de del al y o que en con por para sin sobre es son está están estoy estás hay ha he ' +
      'tengo tiene tienes puedo puede quiero no sí yo tú usted mi mis tu su sus me te se nos le lo les este esta esto ese ' +
      'esa eso pero como cómo qué cuál cuando cuándo donde dónde muy más también ya hola gracias buenos buenas días tardes ' +
      'noches vale perdón disculpa favor ayuda bien funciona'
    ).split(' ')
  ),
  en: new Set(
    (
      "the an and or of to in on at for with from by about is are was were be been am have has had do does did don't " +
      "can can't cannot will would should could i i'm you your you're he she it it's we they my our their this that these " +
      'those what which when where how why not no yes just but so if there here hi hello hey thanks thank please sorry ' +
      'good morning way need help'
    ).split(' ')
  ),
  fr: new Set(
    (
      'le la les un une des du de et ou que qui en dans avec pour par sur sans est sont suis êtes avons avez ai je tu il ' +
      'elle nous vous ils elles mon ma mes ton ta votre vos notre ce cette ces mais pas ne oui non très aussi bonjour ' +
      "bonsoir salut merci beaucoup plaît désolé comment pourquoi quand où c'est j'ai ça marche"
    ).split(' ')
  ),
};

// Caracteres que delatan el idioma (una sola vez por texto, no por aparición).
const CHAR_SIGNALS: Record<Exclude<ReplyLanguage, 'en'>, RegExp> = {
  es: /[ñ¿¡áíóú]/,
  fr: /[çàèêœâîôûùëï]/,
};
const CHAR_SIGNAL_WEIGHT = 2;
// Saludos que solo existen en un idioma: bastan solos para decidir («Hi» → inglés). Sin esto, un
// «Hi» no llegaba al mínimo y ganaba el idioma guardado del contacto.
const GREETINGS: Record<ReplyLanguage, ReadonlySet<string>> = {
  es: new Set(['hola', 'buenas']),
  en: new Set(['hi', 'hello', 'hey']),
  fr: new Set(['bonjour', 'bonsoir', 'salut']),
};
/** Puntos mínimos para decidir: con menos, el texto no dice nada fiable («ok», «Gracias»). */
const MIN_SCORE = 2;

/**
 * Quita lo que el SISTEMA escribe en español dentro de un mensaje del cliente
 * (marcas de adjunto y la descripción de una imagen), que si no arrastraría la
 * detección al español. La transcripción de un audio sí son palabras del
 * cliente: se queda, sin su etiqueta.
 */
function customerWords(text: string): string {
  return text
    .replace(/Contenido de la imagen:[\s\S]*?(?:<<\/adjunto_del_cliente>>|$)/g, ' ')
    .replace(/Transcripción del audio:/g, ' ')
    .replace(/<<\/?adjunto_del_cliente>>/g, ' ')
    .replace(/\[El usuario ha (?:enviado|compartido)[^\]]*\]/g, ' ');
}

/**
 * Idioma de un texto del cliente, o `null` si es demasiado corto o no hay un
 * ganador claro («Hi», «ok», «👍», un número, «de la»).
 *
 * Heurística por palabras funcionales + caracteres propios, sin
 * dependencias. Techo: solo es/en/fr; frases de 1 palabra o de puro vocabulario
 * técnico no deciden; textos mezclados deciden por mayoría simple; otros idiomas
 * romances (pt, it, ca) pueden leerse como es/fr. Si hace falta más, un detector
 * de n-gramas (franc/cld3) o preguntar a un modelo.
 */
export function detectLanguage(text: string): ReplyLanguage | null {
  const clean = customerWords(text).toLowerCase().replace(/[’`]/g, "'");
  const scores: Record<ReplyLanguage, number> = { es: 0, en: 0, fr: 0 };
  for (const word of clean.match(/\p{L}+(?:'\p{L}+)*/gu) ?? []) {
    for (const lang of SUPPORTED) {
      if (GREETINGS[lang].has(word)) scores[lang] += MIN_SCORE;
      else if (FUNCTION_WORDS[lang].has(word)) scores[lang] += 1;
    }
  }
  if (CHAR_SIGNALS.es.test(clean)) scores.es += CHAR_SIGNAL_WEIGHT;
  if (CHAR_SIGNALS.fr.test(clean)) scores.fr += CHAR_SIGNAL_WEIGHT;

  const [first, second] = [...SUPPORTED].sort((a, b) => scores[b] - scores[a]);
  if (scores[first] < MIN_SCORE || scores[first] === scores[second]) return null;
  return first;
}

/**
 * Idioma en que debe ir la respuesta del bot: el del último mensaje del cliente;
 * si ese no decide, el de sus últimos 3 mensajes juntos; si tampoco, el idioma
 * (base) guardado del contacto; y, en último caso, español.
 */
export function resolveReplyLanguage(
  customerMessages: readonly string[],
  contactLanguage: string | null
): ReplyLanguage {
  const last = customerMessages.at(-1);
  const fromLast = last === undefined ? null : detectLanguage(last);
  if (fromLast) return fromLast;
  const fromRecent = detectLanguage(customerMessages.slice(-3).join('\n'));
  if (fromRecent) return fromRecent;
  const contact = contactLanguage ? baseLanguage(contactLanguage) : null;
  return SUPPORTED.find((l) => l === contact) ?? 'es';
}

/**
 * Idioma de los textos FIJOS del bot (los que no escribe el modelo: confirmación
 * de una acción, errores del backend…). Hay versión en los tres idiomas de
 * respuesta, así que es el mismo idioma en que contesta el modelo.
 */
export type FixedTextLanguage = ReplyLanguage;

export function fixedTextLanguage(language: ReplyLanguage): FixedTextLanguage {
  return language;
}

/**
 * El texto del idioma pedido. Con un `Record` el compilador exige los tres: un
 * idioma nuevo no cae en silencio al de otro (lo que pasaba con `idioma === 'en' ? … : …`).
 */
export function segunIdioma<T>(idioma: FixedTextLanguage, textos: Record<FixedTextLanguage, T>): T {
  return textos[idioma];
}
