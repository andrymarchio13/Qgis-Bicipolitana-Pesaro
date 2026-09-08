/**
 * Ancoraggio delle fixture ai dati reali.
 *
 * I punti e gli id usati dagli altri test non sono inventati: corrispondono a
 * elementi del GeoPackage e del grafo. Se una rigenerazione della pipeline li
 * fa sparire o li sposta, il fallimento deve arrivare qui — con il nome
 * dell'elemento mancante — e non sotto forma di un test di routing che smette
 * di verificare quello che dice di verificare.
 */
import { describe, expect, it } from 'vitest';

import { PESARO_BOUNDS } from '../../src/config';
import { RoutingGraphIndex } from '../../src/services/routing/graph';
import { haversine } from '../../src/utils/geo';
import {
  PLACES,
  PLACES_CASI_LIMITE,
  POI_REALI,
  featureById,
  geojson,
  graph,
} from '../helpers';

const inPesaro = ([lng, lat]: [number, number]): boolean =>
  lng >= PESARO_BOUNDS[0][0] &&
  lng <= PESARO_BOUNDS[1][0] &&
  lat >= PESARO_BOUNDS[0][1] &&
  lat <= PESARO_BOUNDS[1][1];

const index = new RoutingGraphIndex(graph());

describe('punti di riferimento', () => {
  it('stanno tutti sulla rete, non solo dentro il riquadro di Pesaro', () => {
    for (const [nome, punto] of Object.entries(PLACES)) {
      const snap = index.snap(punto, 700);
      expect(snap, `${nome} non si aggancia alla rete`).not.toBeNull();
      expect(snap!.distanceMeters, `${nome} troppo lontano dalla rete`).toBeLessThan(120);
    }
  });

  it('coprono quadranti diversi della citta’', () => {
    // Un insieme di punti tutti nello stesso isolato non proverebbe granche':
    // si controlla che l'estensione dei riferimenti sia almeno di 3 km.
    const punti = Object.values(PLACES);
    let massima = 0;
    for (const a of punti) for (const b of punti) massima = Math.max(massima, haversine(a, b));
    expect(massima).toBeGreaterThan(3000);
  });

  it('i casi particolari ricadono nell’area dei dati', () => {
    for (const punto of Object.values(PLACES_CASI_LIMITE)) expect(inPesaro(punto)).toBe(true);
  });
});

/** Archi che toccano un nodo entro `raggio` metri dal punto. */
const archiVicini = (punto: [number, number], raggio = 60) => {
  const nodi = new Set<number>();
  index.nodes.forEach((nodo, i) => {
    if (haversine(punto, nodo) <= raggio) nodi.add(i);
  });
  return index.edges.filter((e) => nodi.has(e.a) || nodi.has(e.b));
};

describe('casi particolari dichiarati dal grafo', () => {
  it('l’obbligo di scendere e’ ancora sugli archi indicati', () => {
    const punti = [
      PLACES_CASI_LIMITE.obbligoScendereLinea5,
      PLACES_CASI_LIMITE.obbligoScendereLinea9,
      PLACES_CASI_LIMITE.obbligoScendereViaBaldi,
    ];
    for (const punto of punti) {
      const archi = archiVicini(punto);
      expect(archi.some((e) => e.dm === 1), `nessun obbligo di scendere in ${punto}`).toBe(true);
    }
  });

  it('il transito vietato e’ ancora dichiarato', () => {
    const archi = archiVicini(PLACES_CASI_LIMITE.transitoVietato, 100);
    expect(archi.some((e) => e.bk === 1)).toBe(true);
  });

  it('il senso unico e’ ancora dichiarato', () => {
    const archi = archiVicini(PLACES_CASI_LIMITE.sensoUnico);
    expect(archi.some((e) => e.ow === 1 || e.ow === -1)).toBe(true);
  });

  it('ogni arco con obbligo di scendere o vietato cita l’ostacolo che lo motiva', () => {
    for (const edge of index.edges) {
      if (!edge.dm && !edge.bk) continue;
      expect(edge.o?.length, `arco ${edge.i} senza ostacolo associato`).toBeGreaterThan(0);
    }
  });
});

describe('POI citati dalle fixture', () => {
  const collezioni = {
    'servizi.geojson': geojson('servizi.geojson'),
    'ostacoli.geojson': geojson('ostacoli.geojson'),
    'svago.geojson': geojson('svago.geojson'),
  };

  const fileDi = (id: string): string =>
    id.startsWith('srv-') ? 'servizi.geojson' : id.startsWith('obs-') ? 'ostacoli.geojson' : 'svago.geojson';

  it('esistono ancora tutti nei GeoJSON esportati', () => {
    for (const [nome, id] of Object.entries(POI_REALI)) {
      const feature = featureById(collezioni[fileDi(id) as keyof typeof collezioni], id);
      expect(feature, `${nome} (${id}) non e' piu' nei dati`).toBeDefined();
      expect(feature!.properties.categoryLabel).toBeTruthy();
    }
  });

  it('gli ostacoli citati riportano l’accesso in bici', () => {
    for (const id of [POI_REALI.barrieraCiclabile, POI_REALI.chicane, POI_REALI.barrieraDoppia]) {
      const feature = featureById(collezioni['ostacoli.geojson'], id);
      expect(feature!.properties.bicycleAccessLabel).toBeTruthy();
    }
  });

  it('i POI usati come punti di riferimento coincidono con le loro coordinate', () => {
    const coppie: [string, [number, number]][] = [
      [POI_REALI.officinaVelomarche, PLACES.velomarche],
      [POI_REALI.noleggioSanDecenzio, PLACES.parcheggioSanDecenzio],
      [POI_REALI.negozioGiunti, PLACES.giuntiBike],
      [POI_REALI.fontanella, PLACES.fontanellaSenzaNome],
      [POI_REALI.parcheggioBici, PLACES.parcheggioBici],
      [POI_REALI.parco, PLACES.parcoSvago],
      [POI_REALI.belvedere, PLACES.belvedereSanBartolo],
    ];
    for (const [id, punto] of coppie) {
      const feature = featureById(collezioni[fileDi(id) as keyof typeof collezioni], id);
      const coords = feature!.geometry.coordinates as [number, number];
      expect(haversine(coords, punto), `${id} si e' spostato`).toBeLessThan(1);
    }
  });
});
