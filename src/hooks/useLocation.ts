/**
 * Accesso alla posizione GPS.
 *
 * La posizione resta nel browser: non viene inviata a nessun server, non
 * viene memorizzata e non lascia il dispositivo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GPS_MAX_ACCEPTABLE_ACCURACY_METERS } from '../config';
import { haversine } from '../utils/geo';

export type GeolocationStatus =
  | 'idle'
  | 'requesting'
  | 'watching'
  | 'denied'
  | 'unavailable'
  | 'error';

export interface UserPosition {
  lng: number;
  lat: number;
  accuracy: number;
  heading: number | null;
  /**
   * Velocita' in m/s. Molti dispositivi non la riportano — quasi nessun
   * portatile, e diversi telefoni finche' il GPS non si e' agganciato — quindi
   * quando manca viene ricavata dallo spostamento fra due punti successivi.
   * Resta `null` solo finche' non c'e' un secondo punto da confrontare.
   */
  speed: number | null;
  timestamp: number;
  /** true se la precisione dichiarata supera la soglia accettabile. */
  imprecise: boolean;
}

export interface UseLocationResult {
  position: UserPosition | null;
  status: GeolocationStatus;
  message: string | null;
  supported: boolean;
  /** Richiede una singola posizione. */
  locate: () => Promise<UserPosition | null>;
  /** Avvia il tracciamento continuo (navigazione). */
  startWatching: () => void;
  stopWatching: () => void;
}

const MESSAGES: Record<number, string> = {
  1: 'Permesso di geolocalizzazione negato. Puoi comunque scegliere il punto di partenza sulla mappa.',
  2: 'Posizione non disponibile in questo momento. Verifica che il GPS sia attivo.',
  3: 'Ricerca della posizione troppo lenta. Riprova all’aperto o scegli il punto sulla mappa.',
};

/**
 * Velocita' ricavata da due punti successivi, quando il dispositivo non la
 * dichiara. Esportata per poterla verificare da sola: e' il calcolo da cui
 * dipende se il ciclista sulla mappa pedala o resta immobile.
 *
 * Le soglie servono a non scambiare il rumore del GPS per movimento: due
 * misure troppo ravvicinate nel tempo, o uno spostamento piu' piccolo della
 * precisione dichiarata, non dicono nulla sulla velocita' reale.
 */
const MIN_SPEED_SAMPLE_MS = 900;
const MAX_PLAUSIBLE_SPEED = 25; // m/s: 90 km/h, oltre e' un salto del GPS

export function derivedSpeed(previous: UserPosition | null, next: UserPosition): number | null {
  if (!previous) return null;
  const elapsed = next.timestamp - previous.timestamp;
  if (elapsed < MIN_SPEED_SAMPLE_MS) return previous.speed;

  const moved = haversine([previous.lng, previous.lat], [next.lng, next.lat]);
  // Uno spostamento dentro l'incertezza della misura puo' essere solo deriva.
  if (moved < Math.min(next.accuracy, 15)) return 0;

  const speed = moved / (elapsed / 1000);
  return speed > MAX_PLAUSIBLE_SPEED ? previous.speed : speed;
}

function toPosition(raw: GeolocationPosition, previous: UserPosition | null): UserPosition {
  const accuracy = raw.coords.accuracy ?? Number.POSITIVE_INFINITY;
  const position: UserPosition = {
    lng: raw.coords.longitude,
    lat: raw.coords.latitude,
    accuracy,
    heading: Number.isFinite(raw.coords.heading) ? raw.coords.heading : null,
    speed: Number.isFinite(raw.coords.speed) ? raw.coords.speed : null,
    timestamp: raw.timestamp,
    imprecise: accuracy > GPS_MAX_ACCEPTABLE_ACCURACY_METERS,
  };
  if (position.speed === null) position.speed = derivedSpeed(previous, position);
  return position;
}

export function useLocation(): UseLocationResult {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [status, setStatus] = useState<GeolocationStatus>(supported ? 'idle' : 'unavailable');
  const [message, setMessage] = useState<string | null>(
    supported ? null : 'Questo browser non supporta la geolocalizzazione.',
  );
  const watchId = useRef<number | null>(null);
  /*
   * Ultimo punto ricevuto. Sta in un riferimento e non nello stato perche'
   * serve dentro le funzioni di richiamo del GPS, che vengono registrate una
   * volta sola e vedrebbero per sempre il valore del primo render.
   */
  const lastPosition = useRef<UserPosition | null>(null);

  const locate = useCallback(async (): Promise<UserPosition | null> => {
    if (!supported) return null;
    setStatus('requesting');
    setMessage(null);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (raw) => {
          const next = toPosition(raw, lastPosition.current);
          lastPosition.current = next;
          setPosition(next);
          setStatus('idle');
          if (next.imprecise) {
            setMessage(
              `Posizione poco precisa (±${Math.round(next.accuracy)} m): il percorso potrebbe partire da un punto vicino.`,
            );
          }
          resolve(next);
        },
        (error) => {
          setStatus(error.code === 1 ? 'denied' : 'error');
          setMessage(MESSAGES[error.code] ?? 'Non è stato possibile ottenere la posizione.');
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
      );
    });
  }, [supported]);

  const startWatching = useCallback(() => {
    if (!supported || watchId.current !== null) return;
    setStatus('watching');
    watchId.current = navigator.geolocation.watchPosition(
      (raw) => {
        const next = toPosition(raw, lastPosition.current);
        lastPosition.current = next;
        setPosition(next);
        setMessage(null);
      },
      (error) => {
        setStatus(error.code === 1 ? 'denied' : 'error');
        setMessage(MESSAGES[error.code] ?? 'Segnale GPS perso.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 },
    );
  }, [supported]);

  const stopWatching = useCallback(() => {
    // Senza tracciamento in corso non c'e' nulla da fermare, e riportare lo
    // stato a 'idle' cancellerebbe un permesso negato di cui l'interfaccia ha
    // ancora bisogno per spiegarsi.
    if (watchId.current === null) return;
    navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setStatus('idle');
  }, []);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
  }, []);

  /*
   * L'oggetto restituito e' memoizzato: chi lo mette fra le dipendenze di un
   * effetto — l'avvio del tracciamento durante la navigazione — altrimenti lo
   * rilancerebbe a ogni singolo render.
   */
  return useMemo(
    () => ({ position, status, message, supported, locate, startWatching, stopWatching }),
    [position, status, message, supported, locate, startWatching, stopWatching],
  );
}
