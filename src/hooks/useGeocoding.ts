/** Ricerca con debounce, annullamento della richiesta precedente e gestione errori. */
import { useCallback, useEffect, useRef, useState } from 'react';

import { GEOCODING } from '../config';
import type { GeocodingResult } from '../types';
import { useAppStore } from '../store/useAppStore';

export interface UseGeocodingResult {
  query: string;
  setQuery: (value: string) => void;
  results: GeocodingResult[];
  loading: boolean;
  error: string | null;
  clear: () => void;
}

export function useGeocoding(): UseGeocodingResult {
  const geocoder = useAppStore((s) => s.geocoder);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    controller.current?.abort();

    const trimmed = query.trim();
    if (!geocoder || trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    timer.current = window.setTimeout(() => {
      const ac = new AbortController();
      controller.current = ac;
      geocoder
        .search(trimmed, ac.signal)
        .then((found) => {
          if (ac.signal.aborted) return;
          setResults(found);
          setError(
            found.length === 0
              ? 'Nessun risultato per questa ricerca nell’area di Pesaro.'
              : null,
          );
        })
        .catch(() => {
          if (ac.signal.aborted) return;
          setResults([]);
          setError('Ricerca non disponibile in questo momento. Riprova fra poco.');
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, GEOCODING.debounceMs);

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [query, geocoder]);

  useEffect(() => () => controller.current?.abort(), []);

  return { query, setQuery, results, loading, error, clear };
}
