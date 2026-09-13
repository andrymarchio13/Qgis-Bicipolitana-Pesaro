/**
 * Test della schermata di arrivo.
 *
 * Si verifica quel che la schermata dice, non come e' animata: i numeri
 * mostrati devono essere quelli misurati, e su un viaggio navigato solo in
 * parte la composizione del percorso non deve comparire affatto.
 *
 * Il markup si costruisce con `createElement` invece che in JSX perche' i test
 * del progetto sono file `.ts`: la resa e' la stessa.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ArrivalSummary } from '../../src/components/Navigation/ArrivalSummary';
import { buildTripSummary, type TripStats } from '../../src/services/tripSummary';
import type { Line, Route } from '../../src/types';

const percorso = (): Route =>
  ({
    id: 'bicipolitana-0',
    distanceMeters: 3200,
    durationSeconds: 840,
    bicipolitanaMeters: 2300,
    bicipolitanaPercentage: 72,
    walkingMeters: 0,
    linesUsed: ['1', '5'],
    segments: [],
    instructions: [],
    warnings: [],
  }) as unknown as Route;

const misura = (over: Partial<TripStats> = {}): TripStats => ({
  startedAt: 1_700_000_000_000,
  elapsedSeconds: 900,
  traveledMeters: 3180,
  maxSpeedKmh: 27.4,
  ...over,
});

const rendi = (stats: TripStats): string =>
  renderToStaticMarkup(
    createElement(ArrivalSummary, {
      route: percorso(),
      summary: buildTripSummary(percorso(), stats),
      lines: new Map<string, Line>(),
      destinationLabel: 'Baia Flaminia',
      onClose: () => {},
    }),
  );

describe('schermata di arrivo', () => {
  it('annuncia l’arrivo e nomina la destinazione', () => {
    const html = rendi(misura());
    expect(html).toContain('Sei arrivato');
    expect(html).toContain('Baia Flaminia');
  });

  it('mostra i numeri misurati del viaggio', () => {
    const html = rendi(misura());
    expect(html).toContain('3.2 km');
    expect(html).toContain('15 min');
    expect(html).toContain('13</b>'); // media, in km/h
    expect(html).toContain('72%');
    expect(html).toContain('27 km/h');
  });

  it('confronta il tempo reale con la stima data prima di partire', () => {
    expect(rendi(misura({ elapsedSeconds: 1200 }))).toContain('in più della stima di 14 min');
    // Un minuto di scarto e' il margine della stima, non un risultato.
    expect(rendi(misura())).toContain('In linea con la stima di 14 min');
  });

  it('su un viaggio navigato a metà dichiara di raccontarne solo un tratto', () => {
    const html = rendi(misura({ traveledMeters: 900 }));
    expect(html).toContain('non ha coperto l’intero percorso');
    // La quota di Bicipolitana vale per il percorso intero: qui non si mostra.
    expect(html).not.toContain('72%');
    expect(html).not.toContain('su Bicipolitana');
  });

  it('non mostra una media che non si è potuta calcolare', () => {
    const html = rendi(misura({ elapsedSeconds: 20, traveledMeters: 200 }));
    expect(html).toContain('media non calcolabile');
  });

  it('dice sempre da dove vengono i numeri', () => {
    expect(rendi(misura())).toContain('misurati durante la navigazione');
  });
});
