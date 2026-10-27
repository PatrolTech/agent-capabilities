import { leerPuestaEnMarcha, type PuestaEnMarcha } from '../domain/puesta-en-marcha.js';
import { ok } from '../domain/tool-result.js';
import { defineRead, type ReadCapability, type ReadEnv } from './types.js';

const resumenDesc =
  'Consulta el resumen general de la cuenta del usuario: rondas de los últimos 7 días por estado (en curso, completadas, incompletas, expiradas), número de vigilantes por estado (activos, inactivos, en alerta), número total de checkpoints y escaneos sospechosos detectados. Úsala cuando el usuario pida un "resumen", "cómo va todo", "estado general", o pregunte por checkpoints.';
const puestaEnMarchaDesc =
  'Checklist de puesta en marcha de la organización: checkpoints creados, vigilantes, vigilantes con algún escaneo (señal de que ya usan la app), si hay escaneos, rutas creadas y `siguientePaso` recomendado. Úsala para «¿qué me falta?», «¿lo tengo bien configurado?» o cuando un cliente nuevo no sabe por dónde seguir.';

/** Siguiente hito de la puesta en marcha, en el orden en que desbloquean el uso real. */
function siguientePaso(h: PuestaEnMarcha): string {
  if (h.checkpointsCreados === 0) {
    return 'Crear el primer checkpoint (Checkpoints → Nuevo checkpoint) e imprimir su QR.';
  }
  if (h.vigilantes === 0)
    return 'Dar de alta al primer vigilante, desde el panel (Patrulleros → Nuevo).';
  if (h.vigilantesConAlgunEscaneo === 0 && !h.hayEscaneos) {
    return 'Que el cliente envíe a cada vigilante su enlace de la app para que haga su primer escaneo.';
  }
  if (h.rutasCreadas === 0) {
    return 'Si quiere controlar rondas con horario, crear una ruta con sus checkpoints (Rutas).';
  }
  return 'Puesta en marcha completa: checkpoints, vigilantes, escaneos y rutas en marcha.';
}

/** Visión general de la cuenta: resumen y checklist de puesta en marcha. */
export function onboardingReads({ gateway }: ReadEnv): ReadCapability[] {
  return [
    defineRead({
      name: 'consultar_resumen_cuenta',
      description: resumenDesc,
      params: {},
      call: async ({ org, token }) => ok(await gateway.getSupportSummary(org.orgId, token)),
    }),
    defineRead({
      name: 'consultar_puesta_en_marcha',
      description: puestaEnMarchaDesc,
      params: {},
      call: async ({ org, token }) => {
        const hitos = await leerPuestaEnMarcha(gateway, org.orgId, token);
        return ok({ ...hitos, siguientePaso: siguientePaso(hitos) });
      },
    }),
  ];
}
