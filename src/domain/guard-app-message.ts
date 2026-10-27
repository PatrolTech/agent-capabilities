import { segunIdioma, type FixedTextLanguage } from './language.js';

/**
 * Mensaje listo para que el administrador se lo reenvíe al vigilante (por
 * WhatsApp o email): qué es, su enlace personal y cómo instalar o abrir la app.
 * El bot no puede enviárselo al vigilante (el backend no tiene esa vía), así
 * que se lo deja preparado al administrador.
 *
 * Solo hechos comprobados del producto: app «Patrol Tech Scan» en Google
 * Play; con ella instalada el enlace abre la app con el vigilante ya elegido y
 * basta pulsar «Iniciar Sesión»; en iPhone no hay app y se usa la web desde el
 * navegador, añadida a la pantalla de inicio; permisos obligatorios Cámara,
 * Ubicación y Notificaciones.
 */
export function guardAppMessage(
  vigilante: string,
  enlace: string,
  idioma: FixedTextLanguage
): string {
  return segunIdioma(idioma, {
    es: [
      `Hola ${vigilante}, te paso tu acceso a PatrolTech, la app con la que escanearás los puntos de control en tus rondas.`,
      `Tu enlace personal (no lo compartas): ${enlace}`,
      '- Android: instala «Patrol Tech Scan» desde Google Play y después abre el enlace: se abre la app con tu nombre ya elegido; solo tienes que pulsar «Iniciar Sesión».',
      '- iPhone: no hay app en la App Store; abre el enlace en el navegador y añádelo a la pantalla de inicio desde el menú del navegador.',
      'Al entrar, concede los permisos de Cámara, Ubicación y Notificaciones.',
    ],
    en: [
      `Hi ${vigilante}, this is your access to PatrolTech, the app you'll use to scan the checkpoints on your rounds.`,
      `Your personal link (don't share it): ${enlace}`,
      '- Android: install «Patrol Tech Scan» from Google Play, then open the link: it opens the app with your name already selected; just tap the sign-in button.',
      "- iPhone: there's no App Store app; open the link in the browser and add it to your home screen from the browser menu.",
      'When you sign in, allow Camera, Location and Notifications.',
    ],
    fr: [
      `Bonjour ${vigilante}, voici votre accès à PatrolTech, l'application avec laquelle vous scannerez les points de contrôle pendant vos rondes.`,
      `Votre lien personnel (ne le partagez pas) : ${enlace}`,
      "- Android : installez «Patrol Tech Scan» depuis Google Play, puis ouvrez le lien : l'application s'ouvre avec votre nom déjà sélectionné ; il suffit d'appuyer sur le bouton de connexion.",
      "- iPhone : il n'y a pas d'application sur l'App Store ; ouvrez le lien dans le navigateur et ajoutez-le à l'écran d'accueil depuis le menu du navigateur.",
      'À la connexion, autorisez la Caméra, la Localisation et les Notifications.',
    ],
  }).join('\n');
}
