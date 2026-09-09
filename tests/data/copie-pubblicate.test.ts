/**
 * I dati del progetto esistono in due copie: `data/`, dove scrive la pipeline
 * Python, e `public/data/`, da cui l'applicazione legge davvero. La seconda e'
 * prodotta da `generate-metadata.py` con una copia byte per byte della prima.
 *
 * La duplicazione e' voluta — su GitHub Pages la pipeline non gira, quindi i
 * file pubblicati devono essere versionati — ma e' anche il punto piu' fragile
 * del progetto: nulla impedisce di rigenerare `data/` dimenticando di
 * ripubblicare, o di correggere a mano una delle due copie. Le due parti
 * divergerebbero in silenzio, e l'applicazione mostrerebbe dati diversi da
 * quelli descritti nella relazione, senza che nessun test se ne accorga:
 * tutti gli altri leggono solo `public/data/`.
 *
 * Questi test confrontano le due copie e falliscono se non coincidono.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..');

/** Le stesse coppie elencate in `PUBLISHED` dentro scripts/generate-metadata.py. */
const COPIE_PUBBLICATE: [sorgente: string, pubblicato: string][] = [
  ['data/geojson/linee_bicipolitana.geojson', 'public/data/linee_bicipolitana.geojson'],
  ['data/geojson/servizi.geojson', 'public/data/servizi.geojson'],
  ['data/geojson/ostacoli.geojson', 'public/data/ostacoli.geojson'],
  ['data/geojson/svago.geojson', 'public/data/svago.geojson'],
  ['data/geojson/strade.geojson', 'public/data/strade.geojson'],
  ['data/lines.json', 'public/data/lines.json'],
  ['data/metadata.json', 'public/data/metadata.json'],
  ['data/routing/graph.json', 'public/data/graph.json'],
];

const sha256 = (relative: string): string =>
  createHash('sha256').update(readFileSync(resolve(root, relative))).digest('hex');

describe('copie pubblicate verso il frontend', () => {
  it.each(COPIE_PUBBLICATE)(
    '%s coincide con la copia pubblicata',
    (sorgente, pubblicato) => {
      expect(existsSync(resolve(root, sorgente)), `manca ${sorgente}`).toBe(true);
      expect(existsSync(resolve(root, pubblicato)), `manca ${pubblicato}`).toBe(true);
      // Il confronto e' sull'impronta e non sul contenuto: questi file arrivano
      // a qualche megabyte, e in caso di differenza il messaggio deve restare
      // leggibile invece di riversare il grafo intero nel terminale.
      expect(
        sha256(pubblicato),
        `${pubblicato} non corrisponde a ${sorgente}: esegui \`npm run data\` per ripubblicare.`,
      ).toBe(sha256(sorgente));
    },
  );

  it('non pubblica file che la pipeline non dichiara', () => {
    // `incidents.json` e' facoltativo e viene copiato solo se presente; tutto
    // il resto in public/data/ deve avere una sorgente in data/.
    const attesi = new Set([
      ...COPIE_PUBBLICATE.map(([, pubblicato]) => pubblicato.split('/').pop()),
      'incidents.json',
    ]);
    const presenti = readdirSync(resolve(root, 'public', 'data'));
    for (const file of presenti) {
      expect(attesi.has(file), `public/data/${file} non è prodotto dalla pipeline`).toBe(true);
    }
  });
});
