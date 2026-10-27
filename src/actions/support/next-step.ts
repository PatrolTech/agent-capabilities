import type { BotActionName } from '../names.js';
import type { FixedTextLanguage } from '../../domain/language.js';
import type { PuestaEnMarcha } from '../../domain/puesta-en-marcha.js';
import { NEXT_STEP_TEXTS, type NextStepButton } from './texts.js';

/** Acciones de la puesta en marcha tras las que el motor propone el siguiente paso. */
export const ONBOARDING_ACTIONS = [
  'create_checkpoint',
  'create_patroller',
  'create_route',
] as const satisfies readonly BotActionName[];
export type OnboardingAction = (typeof ONBOARDING_ACTIONS)[number];

export function isOnboardingAction(nombre: BotActionName): nombre is OnboardingAction {
  return (ONBOARDING_ACTIONS as readonly BotActionName[]).includes(nombre);
}

/** Un mensaje con el siguiente paso y sus botones de respuesta rápida. */
export interface NextStep {
  texto: string;
  opciones: { id: string; name: string }[];
}

/**
 * El siguiente paso de la puesta en marcha (checkpoints → vigilante → app y
 * escaneo de prueba → ruta), decidido con el estado REAL de la organización.
 * Criterio de Víctor: antes que la ruta, la app instalada y un primer escaneo
 * real que cierre el ciclo; hasta entonces no se ofrece crear rutas.
 * `after` es la acción recién hecha; sin ella (nudge) solo hay paso si la
 * cuenta está a medio arrancar: sin checkpoints, sin vigilantes o sin ningún
 * escaneo. Null = no hay nada que proponer.
 */
export function nextOnboardingStep(
  s: PuestaEnMarcha,
  after: OnboardingAction | null,
  idioma: FixedTextLanguage
): NextStep | null {
  const t = NEXT_STEP_TEXTS[idioma];
  const step = (texto: string, botones: NextStepButton[]): NextStep => ({
    texto,
    opciones: botones.map((b) => ({ id: `paso:${b}`, name: t.botones[b] })),
  });
  const escaneado = s.hayEscaneos || s.vigilantesConAlgunEscaneo > 0;

  if (after === 'create_patroller') {
    if (s.checkpointsCreados === 0)
      return step(t.trasVigilanteSinCheckpoints, ['checkpoint', 'otroVigilante']);
    return step(t.trasVigilante, [
      'yaEscaneado',
      'otroVigilante',
      ...(escaneado && s.rutasCreadas === 0 ? (['ruta'] as const) : []),
    ]);
  }
  if (after === null && s.checkpointsCreados === 0) return step(t.faltaCheckpoint, ['checkpoint']);
  if (s.vigilantes === 0) return step(t.faltaVigilante, ['vigilante', 'otroCheckpoint']);
  // Sin un primer escaneo, lo único que se empuja es instalar la app y escanear (ni rutas ni más pasos).
  if (!escaneado) {
    if (after === 'create_checkpoint')
      return step(t.trasCheckpointSinEscaneo, ['yaEscaneado', 'otroCheckpoint']);
    return step(t.faltaEscaneo, ['probarEscaneo', 'yaEscaneado']);
  }
  if (after === 'create_route') return step(t.trasRuta, ['probarEscaneo', 'rondas']);
  if (after === 'create_checkpoint') {
    return s.rutasCreadas === 0
      ? step(t.trasCheckpointSinRutas, ['otroCheckpoint', 'ruta'])
      : step(t.trasCheckpointConRutas, ['otroCheckpoint', 'anadirARuta']);
  }
  return null;
}
