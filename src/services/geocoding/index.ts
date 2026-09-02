/**
 * Geocoding.
 *
 * L'applicazione non e' legata a un singolo servizio: `GeocodingProvider` e'
 * l'interfaccia, e le implementazioni sono componibili.
 *
 *   - LocalGeocodingProvider: cerca nei dati del progetto (POI, linee, nomi
 *     delle vie presenti nel grafo). Funziona offline e senza chiavi.
 *   - NominatimProvider: ripiego per gli indirizzi non presenti nei dati
 *     locali. Limitato all'area di Pesaro, con debounce, timeout e cache.
 *   - CompositeGeocodingProvider: unisce i due, dando la precedenza ai dati
 *     locali e rimuovendo i duplicati.
 */
import { GEOCODING, PESARO_BOUNDS } from '../../config';
import type { GeocodingProvider, GeocodingResult, Line, Poi } from '../../types';
import { haversine } from '../../utils/geo';

const normalise = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Cache LRU minimale, per non ripetere la stessa richiesta di rete. */
class QueryCache<T> {
  private readonly map = new Map<string, T>();

  constructor(private readonly maxSize: number) {}

  get(key: string): T | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

// ---------------------------------------------------------------------------
// Provider locale
// ---------------------------------------------------------------------------

interface LocalEntry {
  result: GeocodingResult;
  haystack: string;
}

export class LocalGeocodingProvider implements GeocodingProvider {
  readonly name = 'Dati del progetto';

  readonly attribution = '© OpenStreetMap contributors — dati del progetto GIS';

  private readonly entries: LocalEntry[] = [];

  constructor(pois: Poi[], lines: Line[], streets: Map<string, [number, number]>) {
    for (const poi of pois) {
      const label = poi.name ?? poi.categoryLabel;
      this.entries.push({
        result: {
          id: `poi:${poi.id}`,
          label,
          sublabel: poi.name ? poi.categoryLabel : null,
          lng: poi.lng,
          lat: poi.lat,
          source: 'locale',
          kind: 'poi',
        },
        haystack: normalise(`${label} ${poi.categoryLabel} ${poi.tags['addr:street'] ?? ''}`),
      });
    }

    for (const line of lines) {
      const endpoint = line.endpoints[0]?.start;
      if (!endpoint) continue;
      const label = line.officialName ? `Linea ${line.id} — ${line.officialName}` : line.name;
      this.entries.push({
        result: {
          id: `line:${line.id}`,
          label,
          sublabel: `Linea Bicipolitana · ${line.lengthKm} km`,
          lng: endpoint[0],
          lat: endpoint[1],
          source: 'locale',
          kind: 'linea',
        },
        haystack: normalise(`${label} bicipolitana linea ${line.id}`),
      });
    }

    for (const [street, [lng, lat]] of streets) {
      this.entries.push({
        result: {
          id: `street:${normalise(street)}`,
          label: street,
          sublabel: 'Pesaro',
          lng,
          lat,
          source: 'locale',
          kind: 'indirizzo',
        },
        haystack: normalise(street),
      });
    }
  }

  async search(query: string): Promise<GeocodingResult[]> {
    const needle = normalise(query);
    if (needle.length < 2) return [];
    const words = needle.split(' ');

    const scored = this.entries
      .map((entry) => {
        if (!words.every((w) => entry.haystack.includes(w))) return null;
        // Un riscontro all'inizio del nome vale piu' di uno a meta' stringa.
        const position = entry.haystack.indexOf(words[0]);
        const score = position === 0 ? 0 : 1 + position / 100;
        return { entry, score };
      })
      .filter((x): x is { entry: LocalEntry; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, GEOCODING.maxResults)
      .map((x) => x.entry.result);

    return scored;
  }

  async reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null> {
    let best: { result: GeocodingResult; distance: number } | null = null;
    for (const entry of this.entries) {
      const distance = haversine([lng, lat], [entry.result.lng, entry.result.lat]);
      if (!best || distance < best.distance) best = { result: entry.result, distance };
    }
    if (!best || best.distance > 250) return null;
    return { ...best.result, distanceMeters: Math.round(best.distance) };
  }
}

// ---------------------------------------------------------------------------
// Provider esterno (Nominatim / compatibile)
// ---------------------------------------------------------------------------

interface NominatimItem {
  place_id?: number | string;
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  type?: string;
  address?: Record<string, string>;
}

export class NominatimProvider implements GeocodingProvider {
  readonly name = 'Nominatim';

  readonly attribution = '© OpenStreetMap contributors';

  private readonly cache = new QueryCache<GeocodingResult[]>(GEOCODING.cacheSize);

  async search(query: string, signal?: AbortSignal): Promise<GeocodingResult[]> {
    if (!GEOCODING.url || query.trim().length < GEOCODING.minQueryLength) return [];
    const key = normalise(query);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const [[minLng, minLat], [maxLng, maxLat]] = PESARO_BOUNDS;
    const url = new URL(GEOCODING.url);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(GEOCODING.maxResults));
    url.searchParams.set('addressdetails', '1');
    // La ricerca e' vincolata all'area coperta dai dati del progetto.
    url.searchParams.set('viewbox', `${minLng},${maxLat},${maxLng},${minLat}`);
    url.searchParams.set('bounded', '1');
    url.searchParams.set('accept-language', 'it');
    if (GEOCODING.apiKey) url.searchParams.set('key', GEOCODING.apiKey);

    const items = await this.request<NominatimItem[]>(url, signal);
    const results = (items ?? [])
      .filter((item) => item.lat && item.lon)
      .map<GeocodingResult>((item, i) => {
        const parts = (item.display_name ?? '').split(',').map((s) => s.trim());
        return {
          id: `ext:${item.place_id ?? i}`,
          label: item.name || parts[0] || 'Risultato',
          sublabel: parts.slice(1, 3).join(', ') || null,
          lng: Number(item.lon),
          lat: Number(item.lat),
          source: 'esterno',
          kind: 'indirizzo',
        };
      });

    this.cache.set(key, results);
    return results;
  }

  async reverseGeocode(
    lat: number,
    lng: number,
    signal?: AbortSignal,
  ): Promise<GeocodingResult | null> {
    if (!GEOCODING.reverseUrl) return null;
    const url = new URL(GEOCODING.reverseUrl);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('accept-language', 'it');
    if (GEOCODING.apiKey) url.searchParams.set('key', GEOCODING.apiKey);

    const item = await this.request<NominatimItem>(url, signal);
    if (!item?.display_name) return null;
    const parts = item.display_name.split(',').map((s) => s.trim());
    return {
      id: `ext:${item.place_id ?? 'reverse'}`,
      label: parts.slice(0, 2).join(', '),
      sublabel: parts.slice(2, 4).join(', ') || null,
      lng,
      lat,
      source: 'esterno',
      kind: 'indirizzo',
    };
  }

  private async request<T>(url: URL, signal?: AbortSignal): Promise<T | null> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), GEOCODING.timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      // Rete assente, timeout o richiesta annullata: la ricerca locale resta
      // comunque disponibile, quindi l'errore non viene propagato.
      return null;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

// ---------------------------------------------------------------------------
// Composizione
// ---------------------------------------------------------------------------

export class CompositeGeocodingProvider implements GeocodingProvider {
  readonly name = 'Composito';

  readonly attribution = '© OpenStreetMap contributors';

  constructor(private readonly providers: GeocodingProvider[]) {}

  async search(query: string, signal?: AbortSignal): Promise<GeocodingResult[]> {
    const settled = await Promise.allSettled(
      this.providers.map((p) => p.search(query, signal)),
    );

    const results: GeocodingResult[] = [];
    const seen = new Set<string>();
    for (const outcome of settled) {
      if (outcome.status !== 'fulfilled') continue;
      for (const result of outcome.value) {
        // Deduplica per etichetta e per prossimita': lo stesso luogo puo'
        // arrivare sia dai dati locali sia dal servizio esterno.
        const labelKey = normalise(result.label);
        const near = results.some(
          (r) => haversine([r.lng, r.lat], [result.lng, result.lat]) < 40,
        );
        if (seen.has(labelKey) || near) continue;
        seen.add(labelKey);
        results.push(result);
      }
    }
    return results.slice(0, GEOCODING.maxResults);
  }

  async reverseGeocode(
    lat: number,
    lng: number,
    signal?: AbortSignal,
  ): Promise<GeocodingResult | null> {
    for (const provider of this.providers) {
      const result = await provider.reverseGeocode(lat, lng, signal);
      if (result) return result;
    }
    return null;
  }
}

/** Estrae dal grafo un indice dei nomi di via, con un punto rappresentativo. */
export function streetIndexFromGraph(
  edges: { n?: string; g: [number, number][] }[],
): Map<string, [number, number]> {
  const accumulator = new Map<string, { lng: number; lat: number; count: number }>();
  for (const edge of edges) {
    if (!edge.n || edge.g.length === 0) continue;
    const middle = edge.g[Math.floor(edge.g.length / 2)];
    const current = accumulator.get(edge.n);
    if (current) {
      current.lng += middle[0];
      current.lat += middle[1];
      current.count += 1;
    } else {
      accumulator.set(edge.n, { lng: middle[0], lat: middle[1], count: 1 });
    }
  }
  const index = new Map<string, [number, number]>();
  for (const [name, value] of accumulator) {
    index.set(name, [value.lng / value.count, value.lat / value.count]);
  }
  return index;
}
