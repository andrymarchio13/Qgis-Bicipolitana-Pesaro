/**
 * Il fondo su cui si pedala.
 *
 * Il tag `surface` di OSM ha decine di valori: `asphalt`, `sett`,
 * `fine_gravel`, `compacted`... Per chi pedala contano molto meno distinzioni,
 * e sempre le stesse tre: liscio, pavé, sterrato. Qui i valori si raggruppano
 * in quelle famiglie — il raggruppamento e' una lettura dichiarata, i valori
 * originali restano nel grafo e nel GeoPackage.
 *
 * Il fondo non dichiarato NON diventa "asfalto". Resta una quarta voce, detta
 * per quello che e': un dato che non c'e'. Su questa rete sono 239 km su 716,
 * troppi per farli sparire in un arrotondamento.
 */

export type SurfaceFamily = 'liscio' | 'pave' | 'sterrato' | 'altro' | 'ignoto';

export interface SurfaceShare {
  family: SurfaceFamily;
  meters: number;
}

/** Come si presenta una famiglia di fondo, e cosa comporta pedalarci. */
export const SURFACE_LOOK: Record<SurfaceFamily, { label: string; icon: string; note: string }> = {
  liscio: { label: 'Asfalto e fondo liscio', icon: '🛣️', note: 'Adatto a qualsiasi bici.' },
  pave: {
    label: 'Pavé e sanpietrini',
    icon: '🧱',
    note: 'Fondo sconnesso: scomodo con gomme sottili.',
  },
  sterrato: {
    label: 'Sterrato, ghiaia, terra',
    icon: '🌾',
    note: 'Meglio con gomme larghe; con la pioggia può essere fangoso.',
  },
  altro: { label: 'Altri fondi', icon: '🪵', note: 'Passerelle in legno, grigliati metallici.' },
  ignoto: {
    label: 'Fondo non dichiarato',
    icon: '❔',
    note: 'I dati OSM non lo indicano: non vuol dire che sia sterrato, né che sia asfalto.',
  },
};

/**
 * A quale famiglia appartiene un valore del tag `surface`.
 *
 * Un valore mai visto prima finisce in `altro`, non in `liscio`: inventare la
 * comodita' di un fondo sconosciuto e' il tipo di ottimismo che fa arrivare
 * una bici da corsa in mezzo alla ghiaia.
 */
export function surfaceFamily(surface: string | undefined): SurfaceFamily {
  if (!surface) return 'ignoto';
  switch (surface) {
    case 'asphalt':
    case 'paved':
    case 'concrete':
    case 'concrete:plates':
    case 'concrete:lanes':
      return 'liscio';
    case 'paving_stones':
    case 'sett':
    case 'cobblestone':
    case 'unhewn_cobblestone':
      return 'pave';
    case 'compacted':
    case 'fine_gravel':
    case 'gravel':
    case 'ground':
    case 'dirt':
    case 'earth':
    case 'unpaved':
    case 'grass':
    case 'sand':
    case 'mud':
      return 'sterrato';
    default:
      return 'altro';
  }
}

/** Ordine di lettura: prima quel che si pedala meglio, in fondo cio' che non si sa. */
const ORDINE: SurfaceFamily[] = ['liscio', 'pave', 'sterrato', 'altro', 'ignoto'];

/** Somma i metri per famiglia e li mette in ordine di lettura. */
export function summarizeSurfaces(entries: { surface?: string; meters: number }[]): SurfaceShare[] {
  const totals = new Map<SurfaceFamily, number>();
  for (const entry of entries) {
    if (entry.meters <= 0) continue;
    const family = surfaceFamily(entry.surface);
    totals.set(family, (totals.get(family) ?? 0) + entry.meters);
  }

  return ORDINE.filter((family) => (totals.get(family) ?? 0) > 0).map((family) => ({
    family,
    meters: Math.round(totals.get(family) ?? 0),
  }));
}

/**
 * Il fondo che merita un avviso: quello che cambia la scelta della bici.
 *
 * Restituisce null quando non c'e' niente di rilevante — sotto i cento metri
 * un tratto di pavé e' un attraversamento, non una caratteristica del viaggio.
 */
export function roughSurface(
  shares: SurfaceShare[],
  minMeters = 100,
): { family: SurfaceFamily; meters: number } | null {
  const rough = shares
    .filter((s) => (s.family === 'sterrato' || s.family === 'pave') && s.meters >= minMeters)
    .sort((a, b) => b.meters - a.meters);
  return rough[0] ?? null;
}
