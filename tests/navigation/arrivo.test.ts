/**
 * Test del riepilogo di fine viaggio.
 *
 * La regola da verificare è una sola, e vale per tutto il file: il riepilogo
 * dice quel che ha misurato e tace su quel che non ha visto. Una navigazione
 * avviata a metà strada non può attribuire al viaggio la composizione
 * dell'intero percorso, e una media oraria nata da trenta secondi di pedalata
 * non è una media.
 */
import { describe, expect, it } from 'vitest';

import {
  buildTripSummary,
  describeDelta,
  spokenDuration,
  spokenTripRecap,
  type TripStats,
} from '../../src/services/tripSummary';
import { announcementFor } from '../../src/services/voiceGuidance';
import type { Route } from '../../src/types';

const percorso = (over: Partial<Route> = {}): Route =>
  ({
    id: 'bicipolitana-0',
    distanceMeters: 3200,
    durationSeconds: 840,
    bicipolitanaMeters: 2300,
    bicipolitanaPercentage: 72,
    walkingMeters: 180,
    linesUsed: ['1', '5'],
    segments: [],
    instructions: [],
    ...over,
  }) as unknown as Route;

const misura = (over: Partial<TripStats> = {}): TripStats => ({
  startedAt: 1_700_000_000_000,
  elapsedSeconds: 900,
  traveledMeters: 3180,
  maxSpeedKmh: 27.4,
  ...over,
});

describe('riepilogo del viaggio', () => {
  it('a viaggio concluso mostra la distanza del percorso, non l’ultima curva', () => {
    const s = buildTripSummary(percorso(), misura());
    expect(s.complete).toBe(true);
    expect(s.distanceMeters).toBe(3200);
  });

  it('calcola la media sui metri percorsi e sul tempo reale', () => {
    const s = buildTripSummary(percorso(), misura({ elapsedSeconds: 900 }));
    // 3200 m in 900 s sono 12,8 km/h.
    expect(s.averageSpeedKmh).toBeCloseTo(12.8, 1);
  });

  it('non calcola una media da pochi secondi di pedalata', () => {
    const s = buildTripSummary(percorso(), misura({ elapsedSeconds: 30 }));
    expect(s.averageSpeedKmh).toBeNull();
  });

  it('confronta il tempo reale con quello stimato', () => {
    const s = buildTripSummary(percorso(), misura({ elapsedSeconds: 900 }));
    expect(s.deltaSeconds).toBe(60);
  });

  it('su un viaggio parziale non attribuisce la composizione del percorso', () => {
    const s = buildTripSummary(percorso(), misura({ traveledMeters: 1000 }));
    expect(s.complete).toBe(false);
    expect(s.distanceMeters).toBe(1000);
    expect(s.linesUsed).toEqual([]);
    expect(s.bicipolitanaPercentage).toBe(0);
    // Il confronto con la stima varrebbe per l'intero percorso: qui non regge.
    expect(s.deltaSeconds).toBeNull();
  });

  it('non fa percorrere più metri di quanti ne abbia il percorso', () => {
    const s = buildTripSummary(percorso(), misura({ traveledMeters: 9999 }));
    expect(s.distanceMeters).toBe(3200);
  });

  it('non produce numeri assurdi quando la navigazione non è mai partita', () => {
    const s = buildTripSummary(
      percorso(),
      misura({ startedAt: null, elapsedSeconds: 0, traveledMeters: 0, maxSpeedKmh: null }),
    );
    expect(s.distanceMeters).toBe(0);
    expect(s.averageSpeedKmh).toBeNull();
    expect(s.complete).toBe(false);
  });
});

describe('durate pronunciate', () => {
  it('scrive le unità per esteso, che la sintesi legge storte', () => {
    expect(spokenDuration(840)).toBe('14 minuti');
    expect(spokenDuration(3900)).toBe("un'ora e 5 minuti");
    expect(spokenDuration(7200)).toBe('2 ore');
  });

  it('non dice «zero minuti»', () => {
    expect(spokenDuration(20)).toBe('meno di un minuto');
  });

  it('non produce mai NaN o undefined', () => {
    expect(spokenDuration(Number.NaN)).toBe('');
    expect(spokenDuration(-10)).toBe('');
  });
});

describe('riepilogo detto ad alta voce', () => {
  it('dice distanza, tempo, media e quota di Bicipolitana', () => {
    const s = buildTripSummary(percorso(), misura({ elapsedSeconds: 900 }));
    expect(spokenTripRecap(s)).toBe(
      'Hai percorso 3 virgola 2 chilometri in 15 minuti, a una media di 13 chilometri orari. 72 per cento sulla Bicipolitana.',
    );
  });

  it('tace sulla media quando non esiste', () => {
    const s = buildTripSummary(percorso(), misura({ elapsedSeconds: 40, traveledMeters: 300 }));
    expect(spokenTripRecap(s)).not.toContain('media');
  });

  it('l’annuncio dell’arrivo porta con sé il riepilogo', () => {
    const s = buildTripSummary(percorso(), misura({ elapsedSeconds: 900 }));
    const annuncio = announcementFor({
      route: percorso(),
      instruction: null,
      distanceToManeuver: 0,
      remainingMeters: 0,
      arrived: true,
      offRoute: false,
      rerouting: false,
      started: true,
      summary: s,
    });
    expect(annuncio?.kind).toBe('arrive');
    expect(annuncio?.text).toContain('Sei arrivato a destinazione.');
    expect(annuncio?.text).toContain('Hai percorso');
  });

  it('senza riepilogo l’arrivo resta una frase sola', () => {
    const annuncio = announcementFor({
      route: percorso(),
      instruction: null,
      distanceToManeuver: 0,
      remainingMeters: 0,
      arrived: true,
      offRoute: false,
      rerouting: false,
      started: true,
    });
    expect(annuncio?.text).toBe('Sei arrivato a destinazione.');
  });
});

describe('confronto con la stima', () => {
  it('non chiama scarto il margine di una stima', () => {
    expect(describeDelta(45, 840)).toBe('In linea con la stima di 14 min.');
  });

  it('dice di quanto si è andati più svelti', () => {
    expect(describeDelta(-300, 840)).toBe('5 min in meno della stima di 14 min.');
  });

  it('dice di quanto ci si è messi di più', () => {
    expect(describeDelta(300, 840)).toBe('5 min in più della stima di 14 min.');
  });
});
