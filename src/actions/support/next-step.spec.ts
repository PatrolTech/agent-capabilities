import { describe, it, expect } from 'vitest';
import { nextOnboardingStep } from './next-step.js';
import type { PuestaEnMarcha } from '../../domain/puesta-en-marcha.js';

/** Organización recién creada: nada hecho todavía. */
const VACIA: PuestaEnMarcha = {
  checkpointsCreados: 0,
  vigilantes: 0,
  vigilantesConAlgunEscaneo: 0,
  hayEscaneos: false,
  ultimoEscaneo: null,
  rutasCreadas: 0,
};
const estado = (s: Partial<PuestaEnMarcha>): PuestaEnMarcha => ({ ...VACIA, ...s });
const botones = (step: ReturnType<typeof nextOnboardingStep>) => step?.opciones.map((o) => o.name);

describe('nextOnboardingStep', () => {
  it('tras un checkpoint y sin vigilantes: dar de alta al vigilante', () => {
    const step = nextOnboardingStep(estado({ checkpointsCreados: 1 }), 'create_checkpoint', 'es');
    expect(step?.texto).toBe(
      'Siguiente paso: dar de alta a tu vigilante para que pueda escanear los QR.'
    );
    expect(botones(step)).toEqual(['Alta de un vigilante', 'Otro checkpoint']);
  });

  // Criterio de Víctor: antes que la ruta, la app instalada y un primer escaneo real.
  it('tras un checkpoint, con vigilantes pero sin ningún escaneo: instalar la app y escanear, sin ofrecer rutas', () => {
    const step = nextOnboardingStep(
      estado({ checkpointsCreados: 2, vigilantes: 1 }),
      'create_checkpoint',
      'es'
    );
    expect(step?.texto).toMatch(
      /que tu vigilante, con la app «Patrol Tech Scan» instalada, lo escanee/
    );
    expect(botones(step)).toEqual(['Ya ha escaneado', 'Otro checkpoint']);
  });

  it('tras un checkpoint, con escaneos y sin rutas: ya se ofrece crear la ruta', () => {
    const step = nextOnboardingStep(
      estado({ checkpointsCreados: 2, vigilantes: 1, hayEscaneos: true }),
      'create_checkpoint',
      'es'
    );
    expect(step?.texto).toMatch(/Como ya funcionan los escaneos, puedes crear una ruta/);
    expect(botones(step)).toEqual(['Otro checkpoint', 'Crear una ruta']);
  });

  it('tras un checkpoint, con vigilantes y rutas: añadirlo a una ruta', () => {
    const step = nextOnboardingStep(
      estado({ checkpointsCreados: 6, vigilantes: 2, hayEscaneos: true, rutasCreadas: 1 }),
      'create_checkpoint',
      'es'
    );
    expect(step?.texto).toBe(
      'Siguiente paso: imprime el QR y colócalo en su sitio. Si quieres que se revise en las rondas, añádelo a una ruta.'
    );
    expect(botones(step)).toEqual(['Otro checkpoint', 'Añadir a una ruta']);
  });

  it('tras un vigilante: que reenvíe el acceso, instale la app y escanee; sin rutas hasta el primer escaneo', () => {
    const step = nextOnboardingStep(
      estado({ checkpointsCreados: 5, vigilantes: 1 }),
      'create_patroller',
      'es'
    );
    expect(step?.texto).toMatch(/para que instale la app y escanee uno de los QR/);
    expect(botones(step)).toEqual(['Ya ha escaneado', 'Otro vigilante']);
    expect(
      botones(
        nextOnboardingStep(
          estado({ checkpointsCreados: 5, vigilantes: 2, hayEscaneos: true }),
          'create_patroller',
          'es'
        )
      )
    ).toEqual(['Ya ha escaneado', 'Otro vigilante', 'Crear una ruta']);
  });

  it('tras un vigilante con rutas ya creadas: sin el botón de crear ruta', () => {
    const step = nextOnboardingStep(
      estado({ checkpointsCreados: 5, vigilantes: 3, rutasCreadas: 2 }),
      'create_patroller',
      'es'
    );
    expect(botones(step)).toEqual(['Ya ha escaneado', 'Otro vigilante']);
  });

  it('tras un vigilante sin checkpoints: primero un checkpoint que escanear', () => {
    const step = nextOnboardingStep(estado({ vigilantes: 1 }), 'create_patroller', 'es');
    expect(step?.texto).toBe(
      'Siguiente paso: crear tu primer checkpoint para que tu vigilante tenga un QR que escanear.'
    );
    expect(botones(step)).toEqual(['Crear un checkpoint', 'Otro vigilante']);
  });

  it('tras una ruta sin ningún escaneo aún: primero el escaneo de prueba', () => {
    const step = nextOnboardingStep(
      estado({ checkpointsCreados: 5, vigilantes: 1, rutasCreadas: 1 }),
      'create_route',
      'es'
    );
    expect(botones(step)).toEqual(['Probar un escaneo', 'Ya ha escaneado']);
  });

  it('tras una ruta: probar un escaneo o ver cómo van las rondas', () => {
    const step = nextOnboardingStep(
      estado({ checkpointsCreados: 5, vigilantes: 1, rutasCreadas: 1, hayEscaneos: true }),
      'create_route',
      'es'
    );
    expect(step?.texto).toBe(
      'Siguiente paso: que tu vigilante haga una ronda de prueba escaneando los QR de la ruta; después te cuento cómo ha ido.'
    );
    expect(botones(step)).toEqual(['Probar un escaneo', 'Cómo van las rondas']);
  });

  it('tras una ruta sin vigilantes: dar de alta al vigilante', () => {
    const step = nextOnboardingStep(
      estado({ checkpointsCreados: 5, rutasCreadas: 1 }),
      'create_route',
      'es'
    );
    expect(step?.texto).toBe(
      'Siguiente paso: dar de alta a tu vigilante para que pueda escanear los QR.'
    );
  });

  describe('sin acción (nudge): solo si la cuenta está a medio arrancar', () => {
    it('sin checkpoints: crear el primero', () => {
      const step = nextOnboardingStep(VACIA, null, 'es');
      expect(step?.texto).toBe(
        'Siguiente paso: crear tu primer checkpoint; te mando su QR para imprimirlo.'
      );
      expect(botones(step)).toEqual(['Crear un checkpoint']);
    });

    it('sin vigilantes: dar de alta al vigilante', () => {
      expect(botones(nextOnboardingStep(estado({ checkpointsCreados: 3 }), null, 'es'))).toEqual([
        'Alta de un vigilante',
        'Otro checkpoint',
      ]);
    });

    it('con vigilantes pero sin ningún escaneo: el escaneo de prueba', () => {
      const step = nextOnboardingStep(estado({ checkpointsCreados: 3, vigilantes: 1 }), null, 'es');
      expect(step?.texto).toMatch(
        /instale la app «Patrol Tech Scan» en su móvil y escanee uno de los QR/
      );
      expect(botones(step)).toEqual(['Probar un escaneo', 'Ya ha escaneado']);
    });

    it('con algún escaneo: nada (la cuenta ya está en marcha)', () => {
      expect(
        nextOnboardingStep(
          estado({ checkpointsCreados: 3, vigilantes: 1, hayEscaneos: true }),
          null,
          'es'
        )
      ).toBeNull();
      expect(
        nextOnboardingStep(
          estado({ checkpointsCreados: 3, vigilantes: 1, vigilantesConAlgunEscaneo: 1 }),
          null,
          'es'
        )
      ).toBeNull();
    });
  });

  it('en inglés, texto y botones en inglés', () => {
    const step = nextOnboardingStep(estado({ checkpointsCreados: 1 }), 'create_checkpoint', 'en');
    expect(step?.texto).toBe('Next step: add your guard so they can scan the QR codes.');
    expect(botones(step)).toEqual(['Add a guard', 'Another checkpoint']);
  });

  it('en francés, texto y botones en francés', () => {
    const step = nextOnboardingStep(estado({ checkpointsCreados: 1 }), 'create_checkpoint', 'fr');
    expect(step?.texto).toBe(
      "Prochaine étape : ajouter votre agent pour qu'il puisse scanner les QR codes."
    );
    expect(botones(step)).toEqual(['Ajouter un agent', 'Un autre checkpoint']);
  });

  it('todas las etiquetas caben en los 20 caracteres de un botón de WhatsApp y los ids son únicos por mensaje', () => {
    const estados = [
      VACIA,
      estado({ checkpointsCreados: 1 }),
      estado({ checkpointsCreados: 1, vigilantes: 1 }),
      estado({ checkpointsCreados: 1, vigilantes: 1, rutasCreadas: 1, hayEscaneos: true }),
      estado({ vigilantes: 1 }),
    ];
    for (const idioma of ['es', 'en', 'fr'] as const) {
      for (const after of [
        'create_checkpoint',
        'create_patroller',
        'create_route',
        null,
      ] as const) {
        for (const s of estados) {
          const step = nextOnboardingStep(s, after, idioma);
          for (const o of step?.opciones ?? [])
            expect(o.name.length, o.name).toBeLessThanOrEqual(20);
          const ids = step?.opciones.map((o) => o.id) ?? [];
          expect(new Set(ids).size).toBe(ids.length);
        }
      }
    }
  });
});
