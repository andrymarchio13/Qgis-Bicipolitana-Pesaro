/**
 * Test della velocita' ricavata dal movimento.
 *
 * Verifica una cosa sola ma importante: senza velocita' il ciclista sulla
 * mappa resta immobile, e molti dispositivi la velocita' non la dichiarano.
 */
import { describe, expect, it } from 'vitest';

import { derivedSpeed, type UserPosition } from '../../src/hooks/useLocation';

/** Punto GPS. `speed` a null imita i dispositivi che non la riportano. */
const punto = (
  lat: number,
  timestamp: number,
  speed: number | null = null,
  accuracy = 5,
): UserPosition => ({
  lng: 12.9,
  lat,
  accuracy,
  heading: null,
  speed,
  timestamp,
  imprecise: false,
});

describe('velocità ricavata dallo spostamento', () => {
  it('resta sconosciuta finché non c’è un punto precedente da confrontare', () => {
    expect(derivedSpeed(null, punto(43.9, 1000))).toBeNull();
  });

  it('la calcola dallo spostamento fra due punti', () => {
    // Un grado di latitudine ≈ 111,2 km: 0,0001° ≈ 11,1 m, in 2 secondi.
    const speed = derivedSpeed(punto(43.9, 1000), punto(43.9001, 3000)) ?? 0;
    expect(speed).toBeGreaterThan(4);
    expect(speed).toBeLessThan(7);
  });

  it('considera fermo uno spostamento dentro l’incertezza della misura', () => {
    const prima = punto(43.9, 1000, null, 20);
    const poi = punto(43.90005, 3000, null, 20);
    expect(derivedSpeed(prima, poi)).toBe(0);
  });

  it('non scambia il rumore del GPS per pedalata nemmeno con misure precise', () => {
    // Mezzo metro con precisione dichiarata di 5 m: deriva, non movimento.
    const speed = derivedSpeed(punto(43.9, 1000), punto(43.900004, 3000));
    expect(speed).toBe(0);
  });

  it('ignora un salto del GPS invece di dichiarare una velocità assurda', () => {
    const prima = punto(43.9, 1000, 5);
    // Mezzo grado in un secondo: un salto, non una pedalata.
    const speed = derivedSpeed(prima, punto(44.4, 2000));
    expect(speed).toBe(5);
  });

  it('non ricalcola su due misure troppo ravvicinate nel tempo', () => {
    const prima = punto(43.9, 1000, 4.5);
    // 200 ms dopo: troppo poco perché la differenza dica qualcosa.
    expect(derivedSpeed(prima, punto(43.90012, 1200))).toBe(4.5);
  });

  it('non inventa una velocità quando nemmeno il punto precedente ne aveva una', () => {
    const prima = punto(43.9, 1000, null);
    expect(derivedSpeed(prima, punto(43.90001, 1200))).toBeNull();
  });
});
