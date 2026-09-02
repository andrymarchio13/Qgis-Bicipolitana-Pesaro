/** Funzioni geometriche di base su coordinate WGS84. */
import type { LngLat } from '../types';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Distanza ortodromica in metri fra due punti [lng, lat]. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Lunghezza complessiva di una polilinea, in metri. */
export function lineLength(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) total += haversine(coords[i - 1], coords[i]);
  return total;
}

/** Rilevamento (bearing) in gradi 0..360 da `a` verso `b`. */
export function bearing(a: LngLat, b: LngLat): number {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLng = toRad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Differenza angolare con segno, in gradi (-180..180). */
export function angleDelta(from: number, to: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  // Un'inversione esatta vale +180: piu' leggibile di -180, ed equivalente.
  return delta === -180 ? 180 : delta;
}

/**
 * Proietta un punto su una polilinea.
 * Ritorna il punto proiettato, la distanza da esso e la progressiva lungo la linea.
 */
export function projectOnLine(
  point: LngLat,
  coords: LngLat[],
): { point: LngLat; distanceMeters: number; offsetMeters: number; index: number } {
  let best = {
    point: coords[0],
    distanceMeters: Number.POSITIVE_INFINITY,
    offsetMeters: 0,
    index: 0,
  };
  let travelled = 0;

  // Scala locale: a questa latitudine 1° di longitudine vale meno di 1° di latitudine.
  const cosLat = Math.cos(toRad(point[1])) || 1;

  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    const segLength = haversine(a, b);

    const ax = a[0] * cosLat;
    const ay = a[1];
    const bx = b[0] * cosLat;
    const by = b[1];
    const px = point[0] * cosLat;
    const py = point[1];

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const proj: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const dist = haversine(point, proj);

    if (dist < best.distanceMeters) {
      best = {
        point: proj,
        distanceMeters: dist,
        offsetMeters: travelled + segLength * t,
        index: i - 1,
      };
    }
    travelled += segLength;
  }

  return best;
}

/** Punto lungo una polilinea a una data progressiva in metri. */
export function pointAtOffset(coords: LngLat[], offsetMeters: number): LngLat {
  if (coords.length === 0) return [0, 0];
  if (offsetMeters <= 0) return coords[0];
  let travelled = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const seg = haversine(coords[i - 1], coords[i]);
    if (travelled + seg >= offsetMeters) {
      const t = seg === 0 ? 0 : (offsetMeters - travelled) / seg;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ];
    }
    travelled += seg;
  }
  return coords[coords.length - 1];
}

/** Bounding box [[minLng, minLat], [maxLng, maxLat]] di una lista di coordinate. */
export function boundsOf(coords: LngLat[]): [[number, number], [number, number]] | null {
  if (coords.length === 0) return null;
  let minLng = coords[0][0];
  let minLat = coords[0][1];
  let maxLng = coords[0][0];
  let maxLat = coords[0][1];
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** Formatta una distanza in metri per l'interfaccia. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

/** Formatta una durata in secondi per l'interfaccia. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 45) return '< 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
