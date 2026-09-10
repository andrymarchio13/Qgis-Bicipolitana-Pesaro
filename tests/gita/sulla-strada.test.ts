/**
 * Test di quel che si incontra sulla strada: acqua, fondo e vento.
 *
 * I punti non sono coordinate inventate: vengono dal GeoPackage del progetto,
 * e i percorsi sono calcolati sul grafo reale.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  CATEGORIE_UTILI,
  DETOUR_DEFAULT_METERS,
  longestDryStretch,
  poisAlongRoute,
  waterAlongRoute,
} from '../../src/services/alongRoute';
import { RoutingGraphIndex } from '../../src/services/routing/graph';
import { BicipolitanaRouter } from '../../src/services/routing/router';
import { roughSurface, summarizeSurfaces, surfaceFamily } from '../../src/services/surface';
import { WIND_MIN_KMH, windOnRoute, windSummary } from '../../src/services/wind';
import type { Line, LngLat, Poi, Route } from '../../src/types';
import { graph, linesFile, PLACES, readJson } from '../helpers';

let percorso: Route;
let pois: Poi[];

/** I POI reali, letti dai file pubblicati come fa l'app. */
const leggiPois = (): Poi[] => {
  const raccolte = ['servizi.geojson', 'svago.geojson'];
  const out: Poi[] = [];
  for (const nome of raccolte) {
    const fc = readJson<{
      features: {
        properties: Record<string, unknown>;
        geometry: { coordinates: [number, number] };
      }[];
    }>(`public/data/${nome}`);
    for (const f of fc.features) {
      out.push({
        id: String(f.properties.id),
        kind: nome === 'servizi.geojson' ? 'servizio' : 'svago',
        category: f.properties.category as Poi['category'],
        categoryLabel: String(f.properties.categoryLabel),
        name: (f.properties.name as string | null) ?? null,
        osmId: (f.properties.osmId as string | null) ?? null,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        tags: {},
      });
    }
  }
  return out;
};

beforeAll(() => {
  const index = new RoutingGraphIndex(graph());
  const lines = new Map<string, Line>(linesFile().lines.map((l) => [l.id, l]));
  const router = new BicipolitanaRouter(index, lines);
  percorso = router.route({
    origin: PLACES.parcheggioSanDecenzio,
    destination: PLACES.lungomareTrieste,
    profiles: ['bicipolitana'],
  })[0]!;
  pois = leggiPois();
});

// ---------------------------------------------------------------------------
// Punti lungo il percorso
// ---------------------------------------------------------------------------

describe('cosa si incontra lungo il percorso', () => {
  it('trova punti reali del GeoPackage vicino a un percorso vero', () => {
    const lungo = poisAlongRoute(pois, percorso.geometry);
    expect(lungo.length).toBeGreaterThan(0);
    for (const item of lungo) {
      expect(CATEGORIE_UTILI).toContain(item.poi.category);
      expect(item.detourMeters).toBeLessThanOrEqual(DETOUR_DEFAULT_METERS);
      expect(item.offsetMeters).toBeGreaterThanOrEqual(0);
      expect(item.offsetMeters).toBeLessThanOrEqual(percorso.distanceMeters + 1);
    }
  });

  it('li restituisce in ordine di incontro', () => {
    const lungo = poisAlongRoute(pois, percorso.geometry);
    for (let i = 1; i < lungo.length; i += 1) {
      expect(lungo[i]!.offsetMeters).toBeGreaterThanOrEqual(lungo[i - 1]!.offsetMeters);
    }
  });

  it('non tira dentro le barriere: non sono cose che si vanno a cercare', () => {
    const lungo = poisAlongRoute(pois, percorso.geometry);
    expect(lungo.some((item) => item.poi.kind === 'ostacolo')).toBe(false);
  });

  it('restringe davvero il raggio di deviazione quando lo si chiede', () => {
    const larghi = poisAlongRoute(pois, percorso.geometry, { maxDetourMeters: 400 });
    const stretti = poisAlongRoute(pois, percorso.geometry, { maxDetourMeters: 20 });
    expect(stretti.length).toBeLessThanOrEqual(larghi.length);
  });

  it('su una geometria degenere non inventa nulla', () => {
    expect(poisAlongRoute(pois, [[12.9, 43.9]] as LngLat[])).toEqual([]);
  });
});

describe('tratto piu lungo senza acqua', () => {
  const acqua = (offsets: number[]): ReturnType<typeof waterAlongRoute> =>
    offsets.map((offsetMeters, i) => ({
      poi: { id: `f${i}`, category: 'fontanella' } as Poi,
      offsetMeters,
      detourMeters: 0,
    }));

  it('senza fontanelle il tratto scoperto e tutto il percorso', () => {
    expect(longestDryStretch([], 8000)).toEqual({ fromMeters: 0, lengthMeters: 8000 });
  });

  it('misura il buco piu ampio fra due fontanelle', () => {
    const asciutto = longestDryStretch(acqua([500, 1200, 6000]), 7000);
    expect(asciutto).toEqual({ fromMeters: 1200, lengthMeters: 4800 });
  });

  it('conta anche il tratto dopo l ultima fontanella', () => {
    const asciutto = longestDryStretch(acqua([300, 900]), 9000);
    expect(asciutto).toEqual({ fromMeters: 900, lengthMeters: 8100 });
  });
});

// ---------------------------------------------------------------------------
// Fondo stradale
// ---------------------------------------------------------------------------

describe('famiglie di fondo', () => {
  it('raggruppa i valori OSM nelle tre famiglie che contano per una bici', () => {
    expect(surfaceFamily('asphalt')).toBe('liscio');
    expect(surfaceFamily('concrete')).toBe('liscio');
    expect(surfaceFamily('sett')).toBe('pave');
    expect(surfaceFamily('paving_stones')).toBe('pave');
    expect(surfaceFamily('fine_gravel')).toBe('sterrato');
    expect(surfaceFamily('ground')).toBe('sterrato');
  });

  it('il fondo non dichiarato non diventa asfalto', () => {
    expect(surfaceFamily(undefined)).toBe('ignoto');
    expect(surfaceFamily('')).toBe('ignoto');
  });

  it('un valore mai visto non viene scambiato per fondo liscio', () => {
    expect(surfaceFamily('woodchips')).toBe('altro');
  });

  it('somma i metri per famiglia senza perderne', () => {
    const shares = summarizeSurfaces([
      { surface: 'asphalt', meters: 1000 },
      { surface: 'paved', meters: 500 },
      { surface: 'gravel', meters: 300 },
      { meters: 200 },
    ]);
    expect(shares).toEqual([
      { family: 'liscio', meters: 1500 },
      { family: 'sterrato', meters: 300 },
      { family: 'ignoto', meters: 200 },
    ]);
  });

  it('segnala il fondo scomodo solo quando è abbastanza lungo da contare', () => {
    expect(roughSurface([{ family: 'sterrato', meters: 40 }])).toBeNull();
    expect(roughSurface([{ family: 'sterrato', meters: 900 }])?.meters).toBe(900);
    expect(roughSurface([{ family: 'liscio', meters: 9000 }])).toBeNull();
  });

  it('su un percorso reale il fondo copre tutta la distanza dichiarata', () => {
    const totale = percorso.surfaces.reduce((sum, s) => sum + s.meters, 0);
    expect(Math.abs(totale - percorso.distanceMeters)).toBeLessThan(3);
  });
});

// ---------------------------------------------------------------------------
// Vento
// ---------------------------------------------------------------------------

describe('vento rispetto alla direzione di marcia', () => {
  /** Un percorso che va dritto verso nord. */
  const versoNord: LngLat[] = [
    [12.9, 43.9],
    [12.9, 43.92],
  ];

  it('riconosce il vento in faccia', () => {
    // Vento "da 0°" viene da nord: andando a nord lo si prende davanti.
    const vento = windOnRoute(versoNord, 0, 25);
    expect(vento?.prevailing).toBe('contro');
    expect(vento?.prevailingShare).toBe(1);
    expect(windSummary(vento!).text).toContain('contro');
  });

  it('riconosce il vento nella schiena', () => {
    const vento = windOnRoute(versoNord, 180, 25);
    expect(vento?.prevailing).toBe('favore');
    expect(windSummary(vento!).text).toContain('favore');
  });

  it('riconosce il vento di traverso', () => {
    const vento = windOnRoute(versoNord, 90, 25);
    expect(vento?.prevailing).toBe('laterale');
  });

  it('tace quando il vento è troppo debole per cambiare la pedalata', () => {
    expect(windOnRoute(versoNord, 0, WIND_MIN_KMH - 1)).toBeNull();
  });

  it('tace quando il servizio non ha dichiarato direzione o velocità', () => {
    expect(windOnRoute(versoNord, null, 30)).toBeNull();
    expect(windOnRoute(versoNord, 180, null)).toBeNull();
  });

  it('ripartisce i metri di un percorso reale senza perderne', () => {
    const vento = windOnRoute(percorso.geometry, 45, 20);
    expect(vento).not.toBeNull();
    const somma = vento!.headMeters + vento!.crossMeters + vento!.tailMeters;
    // Le tre voci sono arrotondate al metro una per una: su un percorso di
    // chilometri lo scarto ammesso e' quello, non una perdita di tratti.
    expect(Math.abs(somma - percorso.distanceMeters) / percorso.distanceMeters).toBeLessThan(0.005);
  });
});
