import type { FixedTextLanguage } from '../../domain/language.js';
import { resolveUrls, type PatrolTechUrls } from '../../domain/urls.js';

/** Textos fijos del motor de acciones en un idioma. */
export interface ActionTexts {
  intro: string;
  pregunta: string;
  sinBotones: string;
  confirmar: string;
  cancelar: string;
  cancelado: string;
  caducada: string;
  noPendiente: string;
  noDisponible: string;
  sinSesion: string;
  sinCambiosAun: string;
  /** Cierre de un lote con fallos: cuántas se hicieron y los números (de la lista) de las que no. */
  loteResumen: (hechas: number, total: number, fallidas: number[]) => string;
  /** Al ejecutar, el backend pidió aceptar las políticas (451): la propuesta sigue viva para volver a confirmarla. */
  politicasPendientes: string;
}

/**
 * Textos fijos del motor de acciones (no los escribe el modelo). En español,
 * inglés y francés; el idioma lo decide `fixedTextLanguage`. `urls` son los
 * enlaces que citan (los mismos que se dan a `actionCatalog`; por defecto, los de producción).
 */
export function actionTexts(
  urls: Partial<PatrolTechUrls> = {}
): Record<FixedTextLanguage, ActionTexts> {
  const { dashboard } = resolveUrls(urls);
  return {
    es: {
      intro: 'Voy a hacer esto por ti:',
      pregunta: '¿Lo confirmas?',
      sinBotones: 'Responde «sí» para confirmarlo o «no» para cancelarlo.',
      confirmar: 'Confirmar',
      cancelar: 'Cancelar',
      cancelado: 'Cancelado, no he cambiado nada.',
      caducada: 'La propuesta caducó; ¿la preparo de nuevo?',
      noPendiente: 'Esa acción ya no está pendiente.',
      noDisponible: 'Esa acción ya no está disponible desde aquí. No se ha hecho ningún cambio.',
      sinSesion:
        'No he podido comprobar tu usuario en el panel. No se ha hecho ningún cambio; inténtalo de nuevo en unos minutos.',
      sinCambiosAun:
        'Aún no he hecho ningún cambio. ¿Quieres que lo prepare para que lo confirmes?',
      loteResumen: (hechas, total, fallidas) =>
        `Hecho: ${hechas} de ${total}. No se ha hecho: ${fallidas.join(', ')}.`,
      politicasPendientes:
        `Antes de hacerlo tienes que aceptar las políticas vigentes en el panel (${dashboard}). ` +
        'Cuando las aceptes, vuelve a pulsar *Confirmar*: lo tengo preparado.',
    },
    en: {
      intro: "Here's what I'll do for you:",
      pregunta: 'Do you confirm?',
      sinBotones: 'Reply «yes» to confirm or «no» to cancel.',
      confirmar: 'Confirm',
      cancelar: 'Cancel',
      cancelado: "Cancelled, I haven't changed anything.",
      caducada: 'That proposal expired; shall I prepare it again?',
      noPendiente: 'That action is no longer pending.',
      noDisponible: 'That action is no longer available from here. No changes have been made.',
      sinSesion:
        "I couldn't verify your user in the dashboard. No changes have been made; please try again in a few minutes.",
      sinCambiosAun:
        "I haven't made any changes yet. Would you like me to prepare it so you can confirm it?",
      loteResumen: (hechas, total, fallidas) =>
        `Done: ${hechas} of ${total}. Not done: ${fallidas.join(', ')}.`,
      politicasPendientes:
        `Before I can do it you need to accept the current policies in the dashboard (${dashboard}). ` +
        "Once you've accepted them, press *Confirm* again: I have it ready.",
    },
    fr: {
      intro: 'Voici ce que je vais faire pour vous :',
      pregunta: 'Vous confirmez ?',
      sinBotones: 'Répondez «oui» pour confirmer ou «non» pour annuler.',
      confirmar: 'Confirmer',
      cancelar: 'Annuler',
      cancelado: "C'est annulé, je n'ai rien modifié.",
      caducada: 'La proposition a expiré ; voulez-vous que je la prépare à nouveau ?',
      noPendiente: "Cette action n'est plus en attente.",
      noDisponible:
        "Cette action n'est plus disponible ici. Aucune modification n'a été effectuée.",
      sinSesion:
        "Je n'ai pas pu vérifier votre utilisateur dans le tableau de bord. Aucune modification n'a été effectuée ; réessayez dans quelques minutes.",
      sinCambiosAun:
        "Je n'ai encore rien modifié. Voulez-vous que je le prépare pour que vous puissiez le confirmer ?",
      loteResumen: (hechas, total, fallidas) =>
        `Fait : ${hechas} sur ${total}. Non fait : ${fallidas.join(', ')}.`,
      politicasPendientes:
        `Pour que je puisse le faire, acceptez les politiques en vigueur dans le tableau de bord (${dashboard}), ` +
        'puis appuyez à nouveau sur *Confirmer* : tout est prêt de mon côté.',
    },
  };
}

/** Botones del siguiente paso de la puesta en marcha. Máximo 20 caracteres (botón de WhatsApp; lo vigila un test). */
export type NextStepButton =
  | 'vigilante'
  | 'otroVigilante'
  | 'checkpoint'
  | 'otroCheckpoint'
  | 'ruta'
  | 'anadirARuta'
  | 'probarEscaneo'
  | 'yaEscaneado'
  | 'rondas';

/**
 * Textos fijos del siguiente paso de la puesta en marcha (tras crear un
 * checkpoint, un vigilante o una ruta, y en el nudge de una cuenta a medio
 * arrancar). Al pulsar un botón llega su texto como un mensaje más del cliente
 * y lo contesta el modelo con sus herramientas.
 */
export const NEXT_STEP_TEXTS: Record<
  FixedTextLanguage,
  {
    faltaCheckpoint: string;
    faltaVigilante: string;
    faltaEscaneo: string;
    trasCheckpointSinEscaneo: string;
    trasCheckpointSinRutas: string;
    trasCheckpointConRutas: string;
    trasVigilante: string;
    trasVigilanteSinCheckpoints: string;
    trasRuta: string;
    botones: Record<NextStepButton, string>;
  }
> = {
  es: {
    faltaCheckpoint: 'Siguiente paso: crear tu primer checkpoint; te mando su QR para imprimirlo.',
    faltaVigilante: 'Siguiente paso: dar de alta a tu vigilante para que pueda escanear los QR.',
    faltaEscaneo:
      'Siguiente paso: que tu vigilante instale la app «Patrol Tech Scan» en su móvil y escanee uno de los QR. Así comprobamos que todo funciona de principio a fin antes de montar las rondas.',
    trasCheckpointSinEscaneo:
      'Siguiente paso: imprime el QR y que tu vigilante, con la app «Patrol Tech Scan» instalada, lo escanee. Es lo más importante ahora: comprobar que el escaneo llega bien antes de montar las rondas.',
    trasCheckpointSinRutas:
      'Siguiente paso: imprime el QR y colócalo en su sitio. Como ya funcionan los escaneos, puedes crear una ruta para controlar las rondas con horario.',
    trasCheckpointConRutas:
      'Siguiente paso: imprime el QR y colócalo en su sitio. Si quieres que se revise en las rondas, añádelo a una ruta.',
    trasVigilante:
      'Siguiente paso: reenvíale el mensaje con su acceso para que instale la app y escanee uno de los QR. Cuando lo haga, lo comprobamos juntos.',
    trasVigilanteSinCheckpoints:
      'Siguiente paso: crear tu primer checkpoint para que tu vigilante tenga un QR que escanear.',
    trasRuta:
      'Siguiente paso: que tu vigilante haga una ronda de prueba escaneando los QR de la ruta; después te cuento cómo ha ido.',
    botones: {
      vigilante: 'Alta de un vigilante',
      otroVigilante: 'Otro vigilante',
      checkpoint: 'Crear un checkpoint',
      otroCheckpoint: 'Otro checkpoint',
      ruta: 'Crear una ruta',
      anadirARuta: 'Añadir a una ruta',
      probarEscaneo: 'Probar un escaneo',
      yaEscaneado: 'Ya ha escaneado',
      rondas: 'Cómo van las rondas',
    },
  },
  en: {
    faltaCheckpoint: "Next step: create your first checkpoint; I'll send you its QR code to print.",
    faltaVigilante: 'Next step: add your guard so they can scan the QR codes.',
    faltaEscaneo:
      'Next step: have your guard install the «Patrol Tech Scan» app on their phone and scan one of the QR codes. That way we check everything works end to end before setting up rounds.',
    trasCheckpointSinEscaneo:
      'Next step: print the QR code and have your guard scan it with the «Patrol Tech Scan» app installed. That is the key thing now: checking the scan arrives before setting up rounds.',
    trasCheckpointSinRutas:
      'Next step: print the QR code and put it in place. Since scans are already working, you can create a route to control rounds on a schedule.',
    trasCheckpointConRutas:
      'Next step: print the QR code and put it in place. If you want it checked on the rounds, add it to a route.',
    trasVigilante:
      'Next step: forward them the message with their access so they install the app and scan one of the QR codes. Once they do, we check it together.',
    trasVigilanteSinCheckpoints:
      'Next step: create your first checkpoint so your guard has a QR code to scan.',
    trasRuta:
      "Next step: have your guard do a test round scanning the route's QR codes; then I'll tell you how it went.",
    botones: {
      vigilante: 'Add a guard',
      otroVigilante: 'Another guard',
      checkpoint: 'Create a checkpoint',
      otroCheckpoint: 'Another checkpoint',
      ruta: 'Create a route',
      anadirARuta: 'Add to a route',
      probarEscaneo: 'Test a scan',
      yaEscaneado: 'Guard has scanned',
      rondas: 'Check the rounds',
    },
  },
  fr: {
    faltaCheckpoint:
      'Prochaine étape : créer votre premier checkpoint ; je vous enverrai son QR code à imprimer.',
    faltaVigilante: "Prochaine étape : ajouter votre agent pour qu'il puisse scanner les QR codes.",
    faltaEscaneo:
      "Prochaine étape : que votre agent installe l'application «Patrol Tech Scan» sur son téléphone et scanne l'un des QR codes. Ainsi, nous vérifions que tout fonctionne de bout en bout avant de mettre en place les rondes.",
    trasCheckpointSinEscaneo:
      "Prochaine étape : imprimez le QR code et demandez à votre agent de le scanner avec l'application «Patrol Tech Scan». C'est le plus important maintenant : vérifier que le scan arrive bien avant de mettre en place les rondes.",
    trasCheckpointSinRutas:
      'Prochaine étape : imprimez le QR code et placez-le à son emplacement. Comme les scans fonctionnent déjà, vous pouvez créer un parcours pour contrôler les rondes selon un horaire.',
    trasCheckpointConRutas:
      "Prochaine étape : imprimez le QR code et placez-le à son emplacement. Si vous voulez qu'il soit contrôlé pendant les rondes, ajoutez-le à un parcours.",
    trasVigilante:
      "Prochaine étape : transférez-lui le message avec son accès pour qu'il installe l'application et scanne l'un des QR codes. Une fois que c'est fait, nous le vérifions ensemble.",
    trasVigilanteSinCheckpoints:
      'Prochaine étape : créer votre premier checkpoint pour que votre agent ait un QR code à scanner.',
    trasRuta:
      "Prochaine étape : que votre agent fasse une ronde de test en scannant les QR codes du parcours ; ensuite, je vous dirai comment cela s'est passé.",
    botones: {
      vigilante: 'Ajouter un agent',
      otroVigilante: 'Un autre agent',
      checkpoint: 'Créer un checkpoint',
      otroCheckpoint: 'Un autre checkpoint',
      ruta: 'Créer un parcours',
      anadirARuta: 'Ajouter au parcours',
      probarEscaneo: 'Tester un scan',
      yaEscaneado: "L'agent a scanné",
      rondas: 'Voir les rondes',
    },
  },
};
