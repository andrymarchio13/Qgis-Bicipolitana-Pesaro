/**
 * Indicatore del meteo di Pesaro, in alto a sinistra sulla mappa.
 *
 * Chiuso mostra il minimo che serve a decidere se uscire in bici: simbolo,
 * temperatura e, se qualcosa sta per cambiare, quando. Toccandolo si apre e
 * dice il resto — percepita, vento, pioggia, le prossime ore e l'ora del
 * tramonto — con l'ora della misura e la fonte, perche' un dato meteo senza
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

import { clockTime } from '../../services/daylight';
import {
  RAIN_CHANCE_THRESHOLD,
  describeWeather,
  isWet,
  rainWindow,
  windCardinal,
  windNote,
  type HourForecast,
} from '../../services/weather';
import { useWeather } from '../../hooks/useWeather';

export interface WeatherBadgeProps {
  /** In navigazione il badge scende in basso, sopra la barra dei dati. */
  placement?: 'map' | 'nav';
}

/**
 * La riga che riassume le prossime ore.
 *
 * E' la frase che decide una gita — «esco adesso o aspetto?» — e dice solo
 * quel che le ore del servizio dichiarano: se non bastano a rispondere, non
 * si prolunga la previsione a naso.
 */
function rainLine(hours: HourForecast[]): string | null {
  const window = rainWindow(hours);
  if (!window) return null;

  if (window.rainingNow) {
    return window.dryFrom
      ? `Piove: asciutto dalle ${clockTime(window.dryFrom)}`
      : 'Piove, e resta piovoso nelle prossime ore';
  }
  if (window.rainFrom) {
    return `Asciutto fino alle ${clockTime(window.rainFrom)}`;
  }
  return window.peakChance !== null && window.peakChance >= 10
    ? `Asciutto nelle prossime ore (max ${window.peakChance}% di pioggia)`
    : 'Asciutto nelle prossime ore';
}

/** Le colonne delle prossime ore, dette a parole per chi non le vede. */
function oreParlate(hours: HourForecast[]): string {
  const voci = hours.map(
    (h) => `${h.time.getHours()}: ${h.rainChance !== null ? `${h.rainChance}%` : 'non dichiarata'}`,
  );
  return `Probabilità di pioggia — ${voci.join(', ')}`;
}

export function WeatherBadge({ placement = 'map' }: WeatherBadgeProps): JSX.Element | null {
  const { report, loading, error, enabled, refresh } = useWeather();
  const [open, setOpen] = useState(false);

  // L'unico caso in cui non si mostra nulla e' il servizio spento a mano.
  if (!enabled) return null;

  const dove = placement === 'nav' ? ' weather--nav' : '';

  if (!report && loading) {
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

  if (!report) {
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

  const weather = report.current;
  const look = describeWeather(weather.code, weather.night);
  const cardinal = windCardinal(weather.windDirection);
  const vento = windNote(weather.windSpeed);
  const bagnato = isWet(weather.code);
  const pioggia = rainLine(report.hours);
  // La striscia oraria salta l'ora in corso: quella e' gia' scritta sopra.
  const prossime = report.hours.slice(1, 7);
  const massima = Math.max(RAIN_CHANCE_THRESHOLD, ...prossime.map((h) => h.rainChance ?? 0));

  return (
    <div
      className={`weather${dove}${open ? ' weather--open' : ''}${bagnato ? ' weather--wet' : ''}`}
    >
      <button
        type="button"
        className="weather__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Meteo a Pesaro: ${look.text}, ${Math.round(weather.temperature)} gradi.${
          pioggia ? ` ${pioggia}.` : ''
        } ${open ? 'Nascondi' : 'Mostra'} i dettagli`}
      >
        <span className="weather__icon" aria-hidden="true">
          {look.icon}
        </span>
        <span className="weather__temp">{Math.round(weather.temperature)}°</span>
        {pioggia ? <span className="weather__lead">{pioggia}</span> : null}
        {loading ? <span className="weather__dot" aria-label="Aggiornamento in corso" /> : null}
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
            {report.sunset ? (
              <>
                <dt>Tramonto</dt>
                <dd>{clockTime(report.sunset)}</dd>
              </>
            ) : null}
          </dl>

          {vento ? <p className="weather__note">💨 {vento}</p> : null}

          {/*
            Qualita' dell'aria: indice europeo EAQI, con il colore ufficiale
            della fascia. Se il servizio non risponde la riga non compare —
            non si scrive "buona" per riempire lo spazio.
          */}
          {report.air ? (
            <p className="weather__air">
              <span className="weather__air-dot" style={{ background: report.air.color }} />
              Aria {report.air.label.toLowerCase()} · EAQI {report.air.index}
              {report.air.pm25 !== null ? (
                <span className="weather__air-detail"> · PM2,5 {Math.round(report.air.pm25)}</span>
              ) : null}
            </p>
          ) : null}

          {prossime.length > 0 ? (
            <>
              {/*
                Le prossime ore: l'altezza della colonna e' la probabilita' di
                pioggia dichiarata dal servizio, non una stima nostra. Le ore
                senza probabilita' restano vuote invece di essere disegnate a
                zero, che vorrebbe dire «non pioverà».
              */}
              <div className="weather__hours" role="img" aria-label={oreParlate(prossime)}>
                {prossime.map((hour) => (
                  <div className="weather__hour" key={hour.time.toISOString()}>
                    <span className="weather__bar-track">
                      {hour.rainChance !== null ? (
                        <span
                          className={`weather__bar${
                            hour.rainChance >= RAIN_CHANCE_THRESHOLD ? ' weather__bar--wet' : ''
                          }`}
                          style={{ height: `${Math.round((hour.rainChance / massima) * 100)}%` }}
                        />
                      ) : (
                        <span className="weather__bar-unknown" title="Probabilità non dichiarata" />
                      )}
                    </span>
                    <span className="weather__hour-label">
                      {hour.time.getHours().toString().padStart(2, '0')}
                    </span>
                    <span className="weather__hour-temp">
                      {hour.temperature !== null ? `${Math.round(hour.temperature)}°` : '–'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="weather__scale">Colonne: probabilità di pioggia dichiarata</p>
            </>
          ) : null}

          <p className="weather__meta">
            Rilevato alle {clockTime(weather.measuredAt)} · Pesaro
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
