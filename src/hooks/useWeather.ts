/**
 * Meteo di Pesaro, tenuto aggiornato e condiviso.
 *
 * Si ricarica da solo a intervalli, ma soprattutto quando serve davvero:
 * tornando sull'app dopo averla lasciata in tasca, e appena la rete torna. Un
 * dato meteo di quaranta minuti prima non e' "attuale", e chi riapre l'app
 * vuole sapere se piove adesso.
 *
 * Lo stato sta fuori da React, in un piccolo deposito condiviso: il meteo
 * serve in piu' punti — l'indicatore sulla mappa, l'avviso sul tramonto nella
 * scheda del percorso — e ognuno con il proprio stato vorrebbe dire una
 * richiesta a testa per lo stesso identico dato.
 */
import { useCallback, useEffect, useState } from 'react';

import { WEATHER_REFRESH_MS, WEATHER_URL } from '../config';
import { fetchWeatherReport, type WeatherReport } from '../services/weather';

export interface UseWeatherResult {
  report: WeatherReport | null;
  loading: boolean;
  /** Messaggio d'errore, quando il meteo non e' disponibile. */
  error: string | null;
  /** false se il servizio e' stato disattivato dalla configurazione. */
  enabled: boolean;
  refresh: () => void;
}

interface WeatherState {
  report: WeatherReport | null;
  loading: boolean;
  error: string | null;
}

const enabled = Boolean(WEATHER_URL);

let state: WeatherState = { report: null, loading: enabled, error: null };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let subscribers = 0;
let timer: number | null = null;

function setState(next: WeatherState): void {
  state = next;
  for (const listener of listeners) listener();
}

async function load(): Promise<void> {
  if (!enabled) return;
  // Una richiesta gia' in volo viene abbandonata: l'ultima chiamata e' quella
  // che conta, e due risposte in ordine sparso mostrerebbero il dato vecchio.
  controller?.abort();
  const current = new AbortController();
  controller = current;

  setState({ ...state, loading: true });
  try {
    const report = await fetchWeatherReport(current.signal);
    if (current.signal.aborted) return;
    setState({ report, loading: false, error: null });
  } catch (cause) {
    if (current.signal.aborted) return;
    /*
     * Il dato precedente viene buttato via di proposito. Tenerlo a schermo
     * dopo un errore lo farebbe passare per attuale, ed e' esattamente cio'
     * che il progetto non fa con nessun altro dato.
     */
    setState({
      report: null,
      loading: false,
      error:
        cause instanceof Error && cause.message
          ? cause.message
          : 'Meteo non disponibile in questo momento.',
    });
  }
}

/** Rinfresca tornando sull'app o appena la rete torna. */
const onWake = (): void => {
  if (document.visibilityState === 'visible') void load();
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  subscribers += 1;
  if (enabled && subscribers === 1) {
    void load();
    timer = window.setInterval(() => void load(), WEATHER_REFRESH_MS);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
  }

  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    if (subscribers === 0) {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      controller?.abort();
      controller = null;
    }
  };
}

export function useWeather(): UseWeatherResult {
  const [, force] = useState(0);

  useEffect(() => subscribe(() => force((n) => n + 1)), []);

  const refresh = useCallback(() => void load(), []);

  return { report: state.report, loading: state.loading, error: state.error, enabled, refresh };
}
