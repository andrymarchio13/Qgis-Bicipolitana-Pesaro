/**
 * Ricerca sui dati locali.
 *
 * Si usano POI e linee di prova: cosi' il test dice come si comporta la
 * ricerca (accenti, maiuscole, POI senza nome, ordine dei risultati) e non
 * quante fontanelle contiene oggi il GeoPackage.
 */
import { describe, expect, it } from 'vitest';

import { LocalGeocodingProvider, streetIndexFromGraph } from '../../src/services/geocoding';
import { GRAFO_DUE_ITINERARI } from '../fixtures/graph';
import { lineaDiProva } from '../fixtures/lines';
import { POI_DI_PROVA, poiPerId } from '../fixtures/poi';

const strade = streetIndexFromGraph(GRAFO_DUE_ITINERARI.edges);
const linee = [
  lineaDiProva('1', { colore: '#e4002b' }),
  lineaDiProva('2', { colore: '#00843d' }),
];
const provider = new LocalGeocodingProvider(POI_DI_PROVA, linee, strade);

describe('ricerca nei dati del progetto', () => {
  it('trova un POI per nome, ignorando maiuscole e accenti', async () => {
    const risultati = await provider.search('OFFICINA di prova');
    expect(risultati[0].id).toBe('poi:srv-prova-1');
    expect(risultati[0].source).toBe('locale');
    expect(risultati[0].kind).toBe('poi');
  });

  it('trova un POI senza nome tramite la sua categoria', async () => {
    const risultati = await provider.search('fontanella');
    const fontanella = risultati.find((r) => r.id === 'poi:srv-prova-2');
    expect(fontanella).toBeDefined();
    // Senza nome nel dataset l'etichetta e' la categoria, non un nome inventato.
    expect(fontanella?.label).toBe('Fontanella');
    expect(fontanella?.sublabel).toBeNull();
  });

  it('trova una linea della Bicipolitana', async () => {
    const risultati = await provider.search('linea 2');
    const linea = risultati.find((r) => r.id === 'line:2');
    expect(linea).toBeDefined();
    expect(linea?.kind).toBe('linea');
    expect(linea?.sublabel).toMatch(/Linea Bicipolitana/);
  });

  it('trova una via presente nel grafo', async () => {
    const risultati = await provider.search('Strada di prova');
    expect(risultati.some((r) => r.kind === 'indirizzo')).toBe(true);
  });

  it('ignora le richieste troppo corte invece di rispondere a caso', async () => {
    expect(await provider.search('a')).toEqual([]);
  });

  it('non restituisce nulla per una parola che non compare nei dati', async () => {
    expect(await provider.search('funivia del monte bianco')).toEqual([]);
  });

  it('dichiara la provenienza dei dati', () => {
    expect(provider.attribution).toMatch(/OpenStreetMap/);
  });
});

describe('ricerca inversa', () => {
  it('restituisce il POI piu’ vicino con la distanza', async () => {
    const officina = poiPerId('srv-prova-1');
    const risultato = await provider.reverseGeocode(officina.lat + 0.0005, officina.lng);
    expect(risultato?.id).toBe('poi:srv-prova-1');
    expect(risultato?.distanceMeters).toBeGreaterThan(0);
    expect(risultato?.distanceMeters).toBeLessThan(100);
  });

  it('non forza un risultato quando non c’e’ niente di vicino', async () => {
    expect(await provider.reverseGeocode(43.95, 12.99)).toBeNull();
  });
});
