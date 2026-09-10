/**
 * Meteo di Pesaro, tenuto aggiornato.
 *
 * Si ricarica da solo a intervalli, ma soprattutto quando serve davvero:
 * tornando sull'app dopo averla lasciata in tasca, e appena la rete torna. Un
 * dato meteo di quaranta minuti prima non e' "attuale", e chi riapre l'app
 * vuole sapere se piove adesso.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { WEATHER_REFRESH_MS, WEATHER_URL } from '../config';
import { fetchCurrentWeather, type CurrentWeather } from '../services/weather';

export interface UseWeatherResult {
  weather: CurrentWeather | null;
  loading: boolean;
  /** Messaggio d'errore, quando il meteo non e' disponibile. */
  error: string | null;
  /** false se il servizio e' stato disattivato dalla configurazione. */
  enabled: boolean;
  refresh: () => void;
}

export function useWeather(): UseWeatherResult {
  const enabled = Boolean(WEATHER_URL);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    // Una richiesta gia' in volo viene abbandonata: l'ultima chiamata e' quella
    // che conta, e due risposte in ordine sparso mostrerebbero il dato vecchio.
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;

    setLoading(true);
    try {
      const next = await fetchCurrentWeather(current.signal);
      if (current.signal.aborted) return;
      setWeather(next);
      setError(null);
    } catch (cause) {
      if (current.signal.aborted) return;
      /*
       * Il dato precedente viene buttato via di proposito. Tenerlo a schermo
       * dopo un errore lo farebbe passare per attuale, ed e' esattamente cio'
       * che il progetto non fa con nessun altro dato.
       */
      setWeather(null);
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'Meteo non disponibile in questo momento.',
      );
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void load();

    const timer = window.setInterval(() => void load(), WEATHER_REFRESH_MS);

    // Tornando sull'app il dato va rinfrescato subito: l'intervallo da solo
    // lascerebbe a schermo il meteo di quando la si e' messa via.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      controller.current?.abort();
    };
  }, [enabled, load]);

  return { weather, loading, error, enabled, refresh: () => void load() };
}
