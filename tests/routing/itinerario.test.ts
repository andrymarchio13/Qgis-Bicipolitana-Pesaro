/** Test del salvataggio su file e della riapertura di un itinerario. */
import { describe, expect, it } from 'vitest';

import {
  buildItinerary,
  ITINERARY_KIND,
  itineraryFileName,
  itineraryTitle,
  parseItinerary,
  serializeItinerary,
  toGpx,
} from '../../src/services/itinerary';
import type { Location, Route } from '../../src/types';

const ORIGINE: Location = {
  lng: 12.9089,
  lat: 43.9061,
  label: 'Piazza del Popolo, Pesaro',
  source: 'geocoder',
};

const DESTINAZIONE: Location = {
  lng: 12.8935,
  lat: 43.9204,
  label: 'Baia Flaminia',
  source: 'poi',
};

const percorso = (): Route => ({
  id: 'bicipolitana-0',
  profile: 'bicipolitana',
  profileLabel: 'Più Bicipolitana',
  profileIcon: '🚲',
  distanceMeters: 3200,
  durationSeconds: 900,
  durationMinutes: 15,
  geometry: [
    [12.9089, 43.9061],
    [12.9012, 43.9134],
    [12.8935, 43.9204],
  ],
  segments: [
    {
      lineId: '1',
      lineName: 'Linea 1',
      color: '#e2001a',
      kind: 'bicipolitana',
      distanceMeters: 3200,
      durationSeconds: 900,
      coordinates: [
        [12.9089, 43.9061],
        [12.8935, 43.9204],
      ],
      streetNames: ['Viale Trieste'],
    },
  ],
  instructions: [
    {
      index: 0,
      type: 'start',
      text: 'Parti da Piazza del Popolo',
      distanceMeters: 3200,
      durationSeconds: 900,
      location: [12.9089, 43.9061],
      lineId: '1',
      color: '#e2001a',
      streetName: 'Viale Trieste',
      offsetMeters: 0,
    },
    {
      index: 1,
      type: 'arrive',
      text: 'Sei arrivato a Baia Flaminia',
      distanceMeters: 0,
      durationSeconds: 0,
      location: [12.8935, 43.9204],
      lineId: null,
      color: null,
      streetName: null,
      offsetMeters: 3200,
    },
  ],
  linesUsed: ['1'],
  bicipolitanaPercentage: 100,
  bicipolitanaMeters: 3200,
  walkingMeters: 0,
  warnings: [],
  obstacleIds: [],
  durationIsEstimate: true,
});

describe('salvataggio e riapertura', () => {
  it('ripristina il percorso e gli estremi identici a com’erano', () => {
    const salvato = serializeItinerary(buildItinerary(percorso(), ORIGINE, DESTINAZIONE));
    const letto = parseItinerary(salvato);

    expect(letto.ok).toBe(true);
    if (!letto.ok) return;

    expect(letto.itinerary.kind).toBe(ITINERARY_KIND);
    expect(letto.itinerary.origin).toEqual(ORIGINE);
    expect(letto.itinerary.destination).toEqual(DESTINAZIONE);
    expect(letto.itinerary.route).toEqual(percorso());
  });

  it('usa i nomi dei due estremi come titolo', () => {
    expect(itineraryTitle(ORIGINE, DESTINAZIONE)).toBe('Piazza del Popolo, Pesaro → Baia Flaminia');
  });

  it('ripiega su etichette generiche quando i nomi mancano', () => {
    expect(itineraryTitle(null, null)).toBe('Partenza → Arrivo');
  });

  it('produce un nome di file senza accenti né caratteri vietati', () => {
    const nome = itineraryFileName(
      { ...ORIGINE, label: 'Città: Pesaro/Centro' },
      DESTINAZIONE,
      'bicipesaro.json',
    );
    expect(nome).toMatch(/^itinerario-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.bicipesaro\.json$/);
    expect(nome).not.toMatch(/[à-ÿ:/\\?*"<>|]/);
  });
});

describe('lettura di file non validi', () => {
  it('rifiuta un file che non è JSON', () => {
    const letto = parseItinerary('non sono un itinerario');
    expect(letto.ok).toBe(false);
  });

  it('rifiuta un JSON di un’altra applicazione', () => {
    const letto = parseItinerary(JSON.stringify({ type: 'FeatureCollection', features: [] }));
    expect(letto.ok).toBe(false);
    if (letto.ok) return;
    expect(letto.message).toMatch(/non è un itinerario/i);
  });

  it('rifiuta una versione del formato che non conosce', () => {
    const itinerary = buildItinerary(percorso(), ORIGINE, DESTINAZIONE);
    const letto = parseItinerary(JSON.stringify({ ...itinerary, version: 99 }));
    expect(letto.ok).toBe(false);
    if (letto.ok) return;
    expect(letto.message).toMatch(/versione/i);
  });

  it('rifiuta un percorso senza geometria percorribile', () => {
    const itinerary = buildItinerary(percorso(), ORIGINE, DESTINAZIONE);
    const letto = parseItinerary(
      JSON.stringify({ ...itinerary, route: { ...itinerary.route, geometry: [[12.9, 43.9]] } }),
    );
    expect(letto.ok).toBe(false);
    if (letto.ok) return;
    expect(letto.message).toMatch(/incompleto o danneggiato/i);
  });

  it('accetta un itinerario senza partenza e destinazione salvate', () => {
    const letto = parseItinerary(serializeItinerary(buildItinerary(percorso(), null, null)));
    expect(letto.ok).toBe(true);
  });
});

describe('esportazione GPX', () => {
  it('contiene la traccia completa e un waypoint per ogni indicazione', () => {
    const gpx = toGpx(buildItinerary(percorso(), ORIGINE, DESTINAZIONE));

    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx).toContain('<trkseg>');
    // Tre punti di geometria.
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
    // Partenza, due indicazioni, arrivo.
    expect(gpx.match(/<wpt /g)).toHaveLength(4);
    expect(gpx).toContain('Sei arrivato a Baia Flaminia');
  });

  it('protegge i caratteri speciali XML nei nomi', () => {
    const gpx = toGpx(
      buildItinerary(percorso(), { ...ORIGINE, label: 'Bar <Da Gigi> & Co.' }, DESTINAZIONE),
    );
    expect(gpx).toContain('Bar &lt;Da Gigi&gt; &amp; Co.');
    expect(gpx).not.toContain('<Da Gigi>');
  });
});
