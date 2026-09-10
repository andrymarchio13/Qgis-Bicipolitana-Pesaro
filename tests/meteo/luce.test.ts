/** Test dell'incrocio fra tramonto, tempo di percorrenza e illuminazione. */
import { describe, expect, it } from 'vitest';

import { darknessOnRoute } from '../../src/services/daylight';
import type { LightingSpan } from '../../src/types';

const alle = (h: number, m = 0): Date => new Date(2026, 8, 10, h, m, 0);

/** Tre tratti da dieci minuti l'uno: illuminato, non dichiarato, non illuminato. */
const TRATTI: LightingSpan[] = [
  { fromSeconds: 0, durationSeconds: 600, distanceMeters: 2500, lit: true },
  { fromSeconds: 600, durationSeconds: 600, distanceMeters: 2500, lit: null },
  { fromSeconds: 1200, durationSeconds: 600, distanceMeters: 2500, lit: false },
];

describe('quando non c’è niente da dire', () => {
  it('tace se si arriva prima del tramonto', () => {
    const buio = darknessOnRoute({
      lighting: TRATTI,
      durationSeconds: 1800,
      departure: alle(15),
      sunset: alle(19, 30),
    });
    expect(buio).toBeNull();
  });

  it('tace se il servizio meteo non ha dichiarato il tramonto', () => {
    const buio = darknessOnRoute({
      lighting: TRATTI,
      durationSeconds: 1800,
      departure: alle(19),
      sunset: null,
    });
    expect(buio).toBeNull();
  });

  it('tace su un percorso di durata nulla', () => {
    const buio = darknessOnRoute({
      lighting: [],
      durationSeconds: 0,
      departure: alle(19),
      sunset: alle(19, 30),
    });
    expect(buio).toBeNull();
  });
});

describe('quanto si pedala dopo il tramonto', () => {
  it('conta solo la parte di viaggio successiva al tramonto', () => {
    // Partenza 19:10, tramonto 19:30, arrivo 19:40: venti minuti con la luce,
    // dieci al buio.
    const buio = darknessOnRoute({
      lighting: TRATTI,
      durationSeconds: 1800,
      departure: alle(19, 10),
      sunset: alle(19, 30),
    });

    expect(buio).not.toBeNull();
    expect(buio!.darkSeconds).toBe(600);
    expect(buio!.arrival.getHours()).toBe(19);
    expect(buio!.arrival.getMinutes()).toBe(40);
    expect(buio!.startsInDark).toBe(false);
    // Al buio si fa il terzo tratto: dichiarato NON illuminato.
    expect(buio!.unlitMeters).toBe(2500);
    expect(buio!.litMeters).toBe(0);
    expect(buio!.unknownMeters).toBe(0);
  });

  it('divide in proporzione il tratto a cavallo del tramonto', () => {
    // Il tramonto cade a meta' del secondo tratto.
    const buio = darknessOnRoute({
      lighting: TRATTI,
      durationSeconds: 1800,
      departure: alle(19, 0),
      sunset: alle(19, 15),
    });

    expect(buio!.darkSeconds).toBe(900);
    expect(buio!.unknownMeters).toBe(1250);
    expect(buio!.unlitMeters).toBe(2500);
    expect(buio!.darkMeters).toBe(3750);
  });

  it('se si parte che è già buio conta tutto il percorso', () => {
    const buio = darknessOnRoute({
      lighting: TRATTI,
      durationSeconds: 1800,
      departure: alle(20),
      sunset: alle(19, 30),
    });

    expect(buio!.startsInDark).toBe(true);
    expect(buio!.darkSeconds).toBe(1800);
    expect(buio!.darkMeters).toBe(7500);
    expect(buio!.litMeters).toBe(2500);
    expect(buio!.unlitMeters).toBe(2500);
    expect(buio!.unknownMeters).toBe(2500);
  });
});

describe('onestà sui dati di illuminazione', () => {
  it('non somma i tratti non dichiarati a quelli dichiarati al buio', () => {
    const buio = darknessOnRoute({
      lighting: TRATTI,
      durationSeconds: 1800,
      departure: alle(20),
      sunset: alle(19, 30),
    });

    // Le tre voci restano separate e insieme fanno il totale: nessun metro
    // senza informazione viene contato come metro al buio dichiarato.
    expect(buio!.litMeters + buio!.unlitMeters + buio!.unknownMeters).toBe(buio!.darkMeters);
  });

  it('un percorso senza illuminazione registrata dichiara il tempo ma non la distanza', () => {
    // E' il caso di un itinerario salvato prima che il dato esistesse.
    const buio = darknessOnRoute({
      lighting: undefined,
      durationSeconds: 1800,
      departure: alle(19, 20),
      sunset: alle(19, 30),
    });

    expect(buio!.darkSeconds).toBe(1200);
    expect(buio!.darkMeters).toBe(0);
    expect(buio!.unknownMeters).toBe(0);
  });
});
