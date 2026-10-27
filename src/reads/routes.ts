import { listarHorarios } from '../domain/route-schedule.js';
import { utcOffsetMinutes } from '../domain/timezone.js';
import { fail, ok } from '../domain/tool-result.js';
import { rutaParamSchema } from './support/params.js';
import { resolveRuta } from './support/resolve.js';
import { isFail } from './support/results.js';
import { defineRead, type ReadCapability, type ReadEnv } from './types.js';

const horariosRutaDesc =
  'Lista los horarios de una ruta en la hora LOCAL del cliente, numerados («1. lun, mar 20:00-21:00»), y si la ruta está activa. Cada horario es una ronda: días en los que empieza y franja (si acaba antes de empezar, cruza la medianoche). Úsala para «¿qué horarios tiene la ruta?» o antes de borrar uno. Si el usuario no dice la ruta, llámala sin `ruta`.';

/** Rutas: sus horarios en la hora del cliente. */
export function routeReads({ gateway }: ReadEnv): ReadCapability[] {
  return [
    defineRead({
      name: 'consultar_horarios_ruta',
      description: horariosRutaDesc,
      params: rutaParamSchema,
      call: async ({ org, token, tz }, { ruta }) => {
        const r = resolveRuta(ruta, (await gateway.listRoutes(org.orgId, token)).items);
        if (isFail(r)) return r;
        const detalle = await gateway.getRouteDetails(r.item.id, token);
        if (!detalle) return fail(`No he podido leer la ruta «${r.item.name}».`);
        const horarios = listarHorarios(detalle.timeWindows, utcOffsetMinutes(tz));
        return ok({
          ruta: r.item.name,
          activa: r.item.isActive,
          zonaHoraria: tz,
          horarios: horarios.map((h, i) => `${i + 1}. ${h.texto}`),
        });
      },
    }),
  ];
}
