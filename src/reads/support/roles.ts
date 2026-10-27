import { segunIdioma, type FixedTextLanguage } from '../../domain/language.js';

/** Cómo se llama cada rol en el panel (lecturas: lo que ve el modelo, en español). */
export const ROL_LABEL: Readonly<Partial<Record<string, string>>> = {
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Observador (Viewer)',
};

/**
 * Cómo se nombra cada rol en las confirmaciones y resultados de las acciones,
 * en el idioma del cliente. Textos distintos de `ROL_LABEL` a propósito (son
 * los que ya ve el cliente en las propuestas del bot): no se unifican sin
 * decidirlo antes.
 */
export const ROL_LABEL_ACCION: Record<
  'VIEWER' | 'EDITOR' | 'ADMIN',
  Record<FixedTextLanguage, string>
> = {
  VIEWER: { es: 'Viewer (solo ver)', en: 'Viewer (view only)', fr: 'Viewer (lecture seule)' },
  EDITOR: { es: 'Editor', en: 'Editor', fr: 'Editor' },
  ADMIN: { es: 'Admin', en: 'Admin', fr: 'Admin' },
};

/** «de toda la organización» / «de la ubicación «X»». */
export function ambito(idioma: FixedTextLanguage, ubicacion: string | undefined): string {
  return segunIdioma(idioma, {
    es: ubicacion ? `de la ubicación «${ubicacion}»` : 'de toda la organización',
    en: ubicacion ? `of the location «${ubicacion}»` : 'of the whole organization',
    fr: ubicacion ? `du site «${ubicacion}»` : "de toute l'organisation",
  });
}
