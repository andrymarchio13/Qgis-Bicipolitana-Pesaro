/**
 * Indicatore del meteo di Pesaro, in alto a sinistra sulla mappa.
 *
 * Chiuso mostra il minimo che serve a decidere se uscire in bici: simbolo e
 * temperatura. Toccandolo si apre e dice il resto — percepita, vento,
 * pioggia — con l'ora della misura e la fonte, perche' un dato meteo senza
 * l'ora a cui si riferisce non e' verificabile.
 *
 * Sta in alto a sinistra perche' e' l'unico angolo libero: a destra ci sono i
 * comandi della mappa, in basso a sinistra la scala. In navigazione scende in
 * basso a sinistra, dove non copre gli avvisi di fuori-percorso.
 *
 * L'indicatore resta sempre a schermo: mentre carica dice che sta caricando e
 * se il servizio non risponde lo dichiara. Sparire in silenzio lascerebbe chi
 * guarda a chiedersi se il meteo non c'e' o se l'app si e' rotta.
 */
import { useState } from 'react';

import { useWeather } from '../../hooks/useWeather';
import { describeWeather, isWet, windCardinal, windNote } from '../../services/weather';

const orario = (date: Date): string =>
  date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

export interface WeatherBadgeProps {
  /** In navigazione il badge scende in basso, sopra la barra dei dati. */
  placement?: 'map' | 'nav';
}

export function WeatherBadge({ placement = 'map' }: WeatherBadgeProps): JSX.Element | null {
  const { weather, loading, error, enabled, refresh } = useWeather();
  const [open, setOpen] = useState(false);

  // L'unico caso in cui non si mostra nulla e' il servizio spento a mano.
  if (!enabled) return null;

  const dove = placement === 'nav' ? ' weather--nav' : '';

  if (!weather && loading) {
    return (
      <div className={`weather weather--muted${dove}`}>
        <span className="weather__head" aria-live="polite">
          <span className="weather__icon" aria-hidden="true">
            🌡️
          </span>
          <span className="weather__temp">Meteo…</span>
        </span>
      </div>
    );
  }

  if (!weather) {
    return (
      <button
        type="button"
        className={`weather weather--error${dove}`}
        onClick={refresh}
        title={error ?? 'Meteo non disponibile'}
      >
        <span className="weather__icon" aria-hidden="true">
          🌡️
        </span>
        <span className="weather__temp">Meteo non disponibile</span>
      </button>
    );
  }

  const look = describeWeather(weather.code, weather.night);
  const cardinal = windCardinal(weather.windDirection);
  const vento = windNote(weather.windSpeed);
  const bagnato = isWet(weather.code);

  return (
    <div
      className={`weather${dove}${open ? ' weather--open' : ''}${bagnato ? ' weather--wet' : ''}`}
    >
      <button
        type="button"
        className="weather__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Meteo a Pesaro: ${look.text}, ${Math.round(weather.temperature)} gradi. ${
          open ? 'Nascondi' : 'Mostra'
        } i dettagli`}
      >
        <span className="weather__icon" aria-hidden="true">
          {look.icon}
        </span>
        <span className="weather__temp">{Math.round(weather.temperature)}°</span>
        {loading ? (
          <span className="weather__dot" aria-label="Aggiornamento in corso" />
        ) : null}
      </button>

      {open ? (
        <div className="weather__body">
          <p className="weather__text">{look.text}</p>

          <dl className="weather__grid">
            {weather.apparentTemperature !== null ? (
              <>
                <dt>Percepita</dt>
                <dd>{Math.round(weather.apparentTemperature)}°</dd>
              </>
            ) : null}
            {weather.windSpeed !== null ? (
              <>
                <dt>Vento</dt>
                <dd>
                  {Math.round(weather.windSpeed)} km/h{cardinal ? ` da ${cardinal}` : ''}
                </dd>
              </>
            ) : null}
            {weather.precipitation !== null ? (
              <>
                <dt>Pioggia</dt>
                <dd>{weather.precipitation > 0 ? `${weather.precipitation} mm` : 'assente'}</dd>
              </>
            ) : null}
          </dl>

          {vento ? <p className="weather__note">💨 {vento}</p> : null}

          <p className="weather__meta">
            Rilevato alle {orario(weather.measuredAt)} · Pesaro
            <br />
            Dati{' '}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer noopener">
              Open-Meteo
            </a>{' '}
            (CC BY 4.0) · si aggiorna da solo
          </p>

          <button type="button" className="weather__refresh" onClick={refresh} disabled={loading}>
            {loading ? 'Aggiornamento…' : 'Aggiorna ora'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
