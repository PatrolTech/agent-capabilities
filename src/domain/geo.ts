import type { FixedTextLanguage } from './language.js';

const RADIO_TIERRA_M = 6_371_000;
const rad = (g: number): number => (g * Math.PI) / 180;

/** Distancia en metros entre dos puntos (haversine, la misma fórmula que el antifraude del backend). */
export function distanciaMetros(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** «56 m» o «3,3 km» (coma decimal en es y fr). */
export function formatoDistancia(metros: number, idioma: FixedTextLanguage): string {
  // Lo que redondea a 1000 m ya va en km (antes salía «1000 m»).
  if (metros < 999.5) return `${Math.round(metros)} m`;
  const km = (metros / 1000).toFixed(metros < 100_000 ? 1 : 0);
  return `${idioma === 'en' ? km : km.replace('.', ',')} km`;
}

/** Enlace de Google Maps a unas coordenadas. */
export function enlaceMapa(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
