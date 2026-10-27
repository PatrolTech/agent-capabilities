import { describe, it, expect } from 'vitest';
import { PatrolTechApiError } from '../domain/backend-errors.js';
import type { IncidentDetail, IncidentTimelineEntry } from '../gateway/index.js';
import { readHarness } from '../testing/index.js';

describe('consultar_incidencias', () => {
  it('lista con número, id, título, estado y prioridad en el idioma del panel, asignado y fecha', async () => {
    const { run } = readHarness();

    const out = await run('consultar_incidencias');

    expect(out.ok).toBe(true);
    expect((out.data as unknown as unknown[])[1]).toEqual({
      numero: 2,
      id: 'inc-2',
      titulo: 'Luz fundida en recepción',
      estado: 'En progreso',
      prioridad: 'Baja',
      asignadoA: 'Marta Ruiz',
      fecha: '2026-07-28T20:00:00Z',
    });
  });

  it('la lista marca las ocultas por la retención sin nombrar el plan', async () => {
    const { run, gateway } = readHarness();
    gateway.incidents[2] = { ...gateway.incidents[2], titulo: null };

    const out = await run('consultar_incidencias');

    const titulos = (out.data as unknown as { titulo: string }[]).map((i) => i.titulo);
    expect(titulos).toContain('(oculta por la retención de datos)');
  });

  it('filtra por estado con el nombre del backend', async () => {
    const { run, gateway } = readHarness();

    const out = await run('consultar_incidencias', { estado: 'abierto' });

    expect(gateway.incidentOpts.at(-1)).toEqual({ estado: 'OPEN' });
    expect((out.data as unknown as { titulo: string }[]).map((i) => i.titulo)).toEqual([
      'Puerta del almacén forzada',
    ]);
  });

  it('con la App de Incidencias apagada, lo dice (no «no tienes permiso»)', async () => {
    const { run, gateway } = readHarness();
    gateway.incidentsError = new PatrolTechApiError(403, '/incidents', {
      message: "Feature 'incident-reporting' is not enabled for this organization",
    });

    const out = await run('consultar_incidencias');

    expect(out.ok).toBe(false);
    expect(out.error).toContain('La App de Incidencias no está activa');
  });
});

const detalle: IncidentDetail = {
  id: 'inc-1',
  oculta: false,
  titulo: 'Puerta del almacén forzada',
  descripcion: 'Apareció abierta a las 3:00 con el bombín roto',
  estado: 'IN_PROGRESS',
  prioridad: 'HIGH',
  categoria: 'Seguridad',
  subcategoria: 'Accesos',
  reportadaPor: 'Juan Pérez',
  asignadaA: 'Marta Ruiz',
  locationId: 'loc-central',
  creadaEn: '2026-07-29T09:00:00Z',
  resueltaEn: null,
  cerradaEn: null,
  checkpoints: ['Almacén'],
  timeline: [
    {
      tipo: 'CREATED',
      autor: 'Juan Pérez',
      texto: null,
      antes: null,
      despues: null,
      fecha: '2026-07-29T09:00:00Z',
      conAdjunto: false,
    },
    {
      tipo: 'STATUS_CHANGE',
      autor: 'Marta Ruiz',
      texto: null,
      antes: 'OPEN',
      despues: 'IN_PROGRESS',
      fecha: '2026-07-29T10:00:00Z',
      conAdjunto: false,
    },
    {
      tipo: 'COMMENT',
      autor: 'Marta Ruiz',
      texto: 'Avisado el cerrajero',
      antes: null,
      despues: null,
      fecha: '2026-07-29T11:00:00Z',
      conAdjunto: true,
    },
  ],
  fotos: 2,
  videos: 1,
};

describe('consultar_incidencia (B2)', () => {
  it('busca por título y devuelve descripción, prioridad, categoría, personas, historial y nº de adjuntos', async () => {
    const { run, gateway } = readHarness();
    gateway.incidentDetails['inc-1'] = detalle;

    const out = await run('consultar_incidencia', { incidencia: 'almacén' });

    expect(out.ok).toBe(true);
    expect(gateway.incidentDetailCalls).toEqual([
      { incidentId: 'inc-1', organizationId: 'org-a', locationId: 'loc-central' },
    ]);
    expect(out.data).toMatchObject({
      titulo: 'Puerta del almacén forzada',
      descripcion: 'Apareció abierta a las 3:00 con el bombín roto',
      estado: 'En progreso',
      prioridad: 'Alta',
      categoria: 'Seguridad / Accesos',
      reportadaPor: 'Juan Pérez',
      asignadaA: 'Marta Ruiz',
      checkpoints: ['Almacén'],
      fotos: 2,
      videos: 1,
    });
    expect(out.data?.historial).toEqual([
      { fecha: '2026-07-29T09:00:00Z', autor: 'Juan Pérez', que: 'Creó la incidencia' },
      {
        fecha: '2026-07-29T10:00:00Z',
        autor: 'Marta Ruiz',
        que: 'Cambió el estado: Abierto → En progreso',
      },
      {
        fecha: '2026-07-29T11:00:00Z',
        autor: 'Marta Ruiz',
        que: 'Comentario: «Avisado el cerrajero» (con un adjunto)',
      },
    ]);
  });

  it('acepta el número de la lista de consultar_incidencias y el id', async () => {
    const { run, gateway } = readHarness();
    gateway.incidentDetails['inc-2'] = {
      ...detalle,
      id: 'inc-2',
      titulo: 'Luz fundida en recepción',
      locationId: 'loc-norte',
    };

    expect((await run('consultar_incidencia', { incidencia: '2' })).ok).toBe(true);
    expect((await run('consultar_incidencia', { incidencia: 'inc-2' })).ok).toBe(true);
    expect(gateway.incidentDetailCalls.map((c) => c.incidentId)).toEqual(['inc-2', 'inc-2']);
  });

  it('borrada entre la lista y el detalle: lo dice sin nombrar una herramienta de un canal', async () => {
    const { run, gateway } = readHarness();
    gateway.incidentDetails = {};

    const out = await run('consultar_incidencia', { incidencia: gateway.incidents[0].id });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/ya no existe/);
    expect(out.error).toMatch(/lista de incidencias/);
    expect(out.error).not.toMatch(/\b(consultar|enviar|proponer|enlace)_[a-z_]+/);
  });

  it('título ambiguo: pregunta cuál', async () => {
    const { run, gateway } = readHarness();
    gateway.incidents.push({
      ...gateway.incidents[0],
      id: 'inc-4',
      titulo: 'Puerta del garaje forzada',
    });

    const out = await run('consultar_incidencia', { incidencia: 'forzada' });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/ambigua/);
  });

  it('oculta por la retención: dice que el plan ya no conserva el detalle', async () => {
    const { run, gateway } = readHarness();
    gateway.incidents[2] = { ...gateway.incidents[2], titulo: null };
    gateway.incidentDetails['inc-3'] = {
      ...detalle,
      id: 'inc-3',
      oculta: true,
      titulo: null,
      descripcion: null,
      timeline: [],
      fotos: 0,
      videos: 0,
    };

    const out = await run('consultar_incidencia', { incidencia: 'inc-3' });

    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ oculta: true });
    expect(out.avisos?.join(' ')).toMatch(/retención/);
    expect(out.avisos?.join(' ')).not.toMatch(/plan/i);
  });

  it('App de Incidencias apagada: lo explica', async () => {
    const { run, gateway } = readHarness();
    gateway.incidentsError = new PatrolTechApiError(403, '/x', {
      success: false,
      message: "Feature 'incident-reporting' is not enabled",
    });

    const out = await run('consultar_incidencia', { incidencia: 'almacén' });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no está activa/);
  });
});

const entrada = (o: Partial<IncidentTimelineEntry>): IncidentTimelineEntry => ({
  tipo: 'COMMENT',
  autor: 'Marta Ruiz',
  texto: null,
  antes: null,
  despues: null,
  fecha: '2026-07-29T11:00:00Z',
  conAdjunto: false,
  ...o,
});

const detalleDe = (o: Partial<IncidentDetail> = {}): IncidentDetail => ({
  id: 'inc-1',
  oculta: false,
  titulo: 'Puerta del almacén forzada',
  descripcion: null,
  estado: 'OPEN',
  prioridad: 'HIGH',
  categoria: null,
  subcategoria: null,
  reportadaPor: null,
  asignadaA: null,
  locationId: 'loc-central',
  creadaEn: '2026-07-29T09:00:00Z',
  resueltaEn: null,
  cerradaEn: null,
  checkpoints: [],
  timeline: [],
  fotos: 0,
  videos: 0,
  ...o,
});

describe('consultar_incidencia: casos límite', () => {
  it('una incidencia llamada «2» gana al número 2 de la lista', async () => {
    const { run, gateway } = readHarness();
    gateway.incidents[0] = { ...gateway.incidents[0], id: 'inc-dos', titulo: '2' };
    gateway.incidentDetails['inc-dos'] = detalleDe({ id: 'inc-dos', titulo: '2' });

    expect((await run('consultar_incidencia', { incidencia: '2' })).ok).toBe(true);
    expect(gateway.incidentDetailCalls.map((c) => c.incidentId)).toEqual(['inc-dos']);
  });

  it('un número fuera de la lista → no encontrada, con las opciones', async () => {
    const { run, gateway } = readHarness();
    const out = await run('consultar_incidencia', { incidencia: '99' });
    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining('no encontrado') as unknown,
    });
    expect(out.opciones).toEqual([
      'Puerta del almacén forzada',
      'Luz fundida en recepción',
      'Cámara rota',
    ]);
    expect(gateway.incidentDetailCalls).toEqual([]);
  });

  it('borrada entre la lista y el detalle (404) → lo dice, no inventa', async () => {
    const { run } = readHarness();
    const out = await run('consultar_incidencia', { incidencia: 'cámara' });
    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining('ya no existe') as unknown,
    });
  });

  it('las ocultas por retención no casan por texto y salen por su id en las opciones', async () => {
    const { run, gateway } = readHarness();
    gateway.incidents[2] = { ...gateway.incidents[2], titulo: null };
    const out = await run('consultar_incidencia', { incidencia: 'cámara' });
    expect(out.ok).toBe(false);
    expect(out.opciones).toContain('inc-3');
  });

  it('historial con solo fotos y un comentario sin texto con adjunto: frases limpias, sin ««»»', async () => {
    const { run, gateway } = readHarness();
    gateway.incidentDetails['inc-1'] = detalleDe({
      timeline: [
        entrada({ tipo: 'MEDIA_ADDED', conAdjunto: true }),
        entrada({ tipo: 'COMMENT', texto: null, conAdjunto: true }),
        entrada({ tipo: 'ASSIGNMENT_CHANGE', despues: null }),
        entrada({ tipo: 'PRIORITY_CHANGE', antes: 'LOW', despues: 'CRITICAL' }),
        entrada({ tipo: 'ALGO_NUEVO', texto: null }),
      ],
      fotos: 3,
    });

    const out = await run('consultar_incidencia', { incidencia: 'almacén' });

    expect((out.data?.historial as { que: string }[]).map((h) => h.que)).toEqual([
      'Añadió una foto o un vídeo',
      'Comentario con un adjunto',
      'Quitó la asignación',
      'Cambió la prioridad: Baja → Crítica',
      'ALGO_NUEVO',
    ]);
  });

  it('quien la reportó oculto por privacidad (null) viaja como null, sin inventar un nombre', async () => {
    const { run, gateway } = readHarness();
    gateway.incidentDetails['inc-1'] = detalleDe({ reportadaPor: null, asignadaA: null });
    const out = await run('consultar_incidencia', { incidencia: 'almacén' });
    expect(out.data).toMatchObject({ reportadaPor: null, asignadaA: null, categoria: null });
  });

  it('más de 30 entradas: las 30 más recientes y un aviso', async () => {
    const { run, gateway } = readHarness();
    const timeline = Array.from({ length: 35 }, (_, i) =>
      entrada({ texto: `c${i}`, fecha: `2026-07-29T${String(i % 24).padStart(2, '0')}:00:00Z` })
    );
    gateway.incidentDetails['inc-1'] = detalleDe({ timeline });
    const out = await run('consultar_incidencia', { incidencia: 'almacén' });
    const historial = out.data?.historial as { que: string }[];
    expect(historial).toHaveLength(30);
    expect(historial[0].que).toBe('Comentario: «c5»');
    expect(out.avisos?.join(' ')).toMatch(/35 entradas/);
  });
});
