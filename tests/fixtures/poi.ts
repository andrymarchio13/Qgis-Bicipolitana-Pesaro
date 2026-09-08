/**
 * Punti di interesse di prova.
 *
 * Servono ai test che devono controllare *come* un POI viene trattato
 * (ricerca, etichette, ordinamento per distanza, accesso in bici) senza
 * dipendere da quanti POI contiene oggi il GeoPackage: quel numero cambia a
 * ogni rigenerazione dei dati, il comportamento no.
 *
 * Le etichette di categoria sono le stesse prodotte dalla pipeline
 * (`scripts/convert-gpkg.py`), cosi' i test non validano una traduzione che
 * nell'applicazione non esiste.
 */
import type { Poi, PoiCategory, PoiKind } from '../../src/types';

export const ETICHETTE_CATEGORIA: Record<string, string> = {
  fontanella: 'Fontanella',
  parcheggio_bici: 'Parcheggio bici',
  noleggio: 'Noleggio bici',
  officina: 'Officina / riparazione',
  negozio_bici: 'Negozio di biciclette',
  altro_servizio: 'Altro servizio',
  parco: 'Parco',
  belvedere: 'Belvedere',
  area_picnic: 'Area picnic',
  panchina: 'Panchina',
  binocolo: 'Binocolo',
  altro_svago: 'Altro punto di svago',
  barriera_ciclabile: 'Barriera ciclabile',
  barriera_doppia: 'Barriera doppia',
  barriera_tripla: 'Barriera tripla',
  chicane: 'Chicane',
  altra_barriera: 'Altra barriera',
  ostacolo_generico: 'Ostacolo',
};

export interface OpzioniPoi {
  nome?: string | null;
  osmId?: string | null;
  tags?: Record<string, string>;
  /** Solo ostacoli: valore del tag OSM `bicycle`. */
  accessoBici?: string | null;
  etichettaAccessoBici?: string;
  larghezzaMassimaMetri?: string | null;
}

/** Costruisce un `Poi` valido: null dove il dato non c'e', mai un segnaposto. */
export function poiDiProva(
  id: string,
  kind: PoiKind,
  category: PoiCategory,
  lng: number,
  lat: number,
  opzioni: OpzioniPoi = {},
): Poi {
  const poi: Poi = {
    id,
    kind,
    category,
    categoryLabel: ETICHETTE_CATEGORIA[category] ?? category,
    name: opzioni.nome ?? null,
    osmId: opzioni.osmId ?? null,
    lng,
    lat,
    tags: opzioni.tags ?? {},
  };
  if (kind === 'ostacolo') {
    poi.bicycleAccess = opzioni.accessoBici ?? null;
    poi.bicycleAccessLabel =
      opzioni.etichettaAccessoBici ?? 'Informazione non disponibile';
    poi.maxWidthMeters = opzioni.larghezzaMassimaMetri ?? null;
  }
  return poi;
}

/**
 * Un POI per ciascun caso che l'interfaccia deve saper gestire:
 * con nome e senza, con tag di indirizzo e senza, con accesso in bici noto,
 * negato o non dichiarato.
 */
export const POI_DI_PROVA: Poi[] = [
  poiDiProva('srv-prova-1', 'servizio', 'officina', 12.9, 43.9, {
    nome: 'Officina di prova',
    osmId: '1',
    tags: { shop: 'bicycle', 'addr:street': 'Via di Prova' },
  }),
  // Senza nome: nella ricerca e nelle liste deve comparire la categoria.
  poiDiProva('srv-prova-2', 'servizio', 'fontanella', 12.902, 43.9, {
    tags: { amenity: 'drinking_water' },
  }),
  poiDiProva('srv-prova-3', 'servizio', 'parcheggio_bici', 12.904, 43.9, {
    tags: { amenity: 'bicycle_parking', capacity: '12' },
  }),
  poiDiProva('svg-prova-1', 'svago', 'parco', 12.906, 43.9, {
    nome: 'Parco di prova',
    tags: { leisure: 'park' },
  }),
  // Ostacolo transitabile.
  poiDiProva('obs-prova-1', 'ostacolo', 'barriera_ciclabile', 12.908, 43.9, {
    tags: { barrier: 'cycle_barrier', bicycle: 'yes' },
    accessoBici: 'yes',
    etichettaAccessoBici: 'Transito consentito',
  }),
  // Ostacolo con obbligo di scendere.
  poiDiProva('obs-prova-2', 'ostacolo', 'chicane', 12.91, 43.9, {
    tags: { barrier: 'chicane', bicycle: 'dismount' },
    accessoBici: 'dismount',
    etichettaAccessoBici: 'Obbligo di scendere dalla bici',
  }),
  // Ostacolo senza tag `bicycle`: il dato manca e va dichiarato come tale.
  poiDiProva('obs-prova-3', 'ostacolo', 'barriera_doppia', 12.912, 43.9, {
    tags: { barrier: 'cycle_barrier' },
  }),
];

export const poiPerId = (id: string): Poi => {
  const poi = POI_DI_PROVA.find((p) => p.id === id);
  if (!poi) throw new Error(`POI di prova inesistente: ${id}`);
  return poi;
};
