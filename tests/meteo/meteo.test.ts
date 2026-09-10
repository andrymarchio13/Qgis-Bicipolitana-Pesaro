/** Test del meteo: lettura dei codici WMO, vento e risposte del servizio. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describeWeather,
  fetchCurrentWeather,
  isWet,
  windCardinal,
  windNote,
} from '../../src/services/weather';

// ---------------------------------------------------------------------------
// Codici meteo
// ---------------------------------------------------------------------------

describe('descrizione dei codici WMO', () => {
  it('traduce il codice nella descrizione dello standard', () => {
    expect(describeWeather(3).text).toBe('Coperto');
    expect(describeWeather(95).text).toBe('Temporale');
  });

  it('di notte cambia il simbolo del sereno ma non la descrizione', () => {
    const giorno = describeWeather(0);
    const notte = describeWeather(0, true);
    expect(notte.text).toBe(giorno.text);
    expect(notte.icon).not.toBe(giorno.icon);
  });

  it('di notte tiene il simbolo di chi non ne ha uno notturno', () => {
    expect(describeWeather(3, true).icon).toBe(describeWeather(3).icon);
  });

  it('dichiara di non conoscere un codice fuori tabella invece di inventarlo', () => {
    expect(describeWeather(7777).text).toBe('Condizioni non riconosciute');
  });

  it('riconosce come bagnati i codici da pioggia in su', () => {
    expect(isWet(0)).toBe(false);
    expect(isWet(3)).toBe(false);
    expect(isWet(51)).toBe(true);
    expect(isWet(95)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vento
// ---------------------------------------------------------------------------

describe('direzione del vento', () => {
  it('riporta i gradi al punto della rosa dei venti', () => {
    expect(windCardinal(0)).toBe('N');
    expect(windCardinal(45)).toBe('NE');
    expect(windCardinal(180)).toBe('S');
    expect(windCardinal(270)).toBe('O');
  });

  it('chiude il cerchio invece di uscire dalla rosa', () => {
    expect(windCardinal(359)).toBe('N');
    expect(windCardinal(360)).toBe('N');
    expect(windCardinal(-90)).toBe('O');
  });

  it('non inventa una direzione quando il dato manca', () => {
    expect(windCardinal(null)).toBeNull();
    expect(windCardinal(Number.NaN)).toBeNull();
  });
});

describe('nota sul vento', () => {
  it('tace quando il vento non cambia la pedalata', () => {
    expect(windNote(0)).toBeNull();
    expect(windNote(11)).toBeNull();
    expect(windNote(null)).toBeNull();
  });

  it('avvisa in modo diverso man mano che il vento cresce', () => {
    expect(windNote(15)).toContain('Brezza');
    expect(windNote(30)).toContain('teso');
    expect(windNote(50)).toContain('forte');
  });
});

// ---------------------------------------------------------------------------
// Richiesta al servizio
// ---------------------------------------------------------------------------

const risposta = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response;

const attuale = {
  time: '2026-09-10T09:00',
  temperature_2m: 21.4,
  apparent_temperature: 20.1,
  precipitation: 0,
  weather_code: 2,
  wind_speed_10m: 14.2,
  wind_direction_10m: 43,
  is_day: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('richiesta del meteo attuale', () => {
  it('chiede il dato di Pesaro e ne legge i campi', async () => {
    const fetchMock = vi.fn(async (_url: string) => risposta({ current: attuale }));
    vi.stubGlobal('fetch', fetchMock);

    const meteo = await fetchCurrentWeather();

    expect(meteo.temperature).toBe(21.4);
    expect(meteo.windSpeed).toBe(14.2);
    expect(meteo.code).toBe(2);
    expect(meteo.night).toBe(false);
    expect(meteo.measuredAt.getHours()).toBe(9);

    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.searchParams.get('timezone')).toBe('Europe/Rome');
    expect(url.searchParams.get('current')).toContain('wind_speed_10m');
  });

  it('lascia a null i valori che il servizio non manda, senza stimarli', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        risposta({ current: { time: attuale.time, temperature_2m: 18, weather_code: 0 } }),
      ),
    );

    const meteo = await fetchCurrentWeather();

    expect(meteo.windSpeed).toBeNull();
    expect(meteo.apparentTemperature).toBeNull();
    expect(meteo.precipitation).toBeNull();
  });

  it('segnala la notte quando il servizio la dichiara', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => risposta({ current: { ...attuale, is_day: 0 } })),
    );
    expect((await fetchCurrentWeather()).night).toBe(true);
  });

  it('fallisce invece di restituire un meteo incompleto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => risposta({ current: { time: attuale.time, weather_code: 1 } })),
    );
    await expect(fetchCurrentWeather()).rejects.toThrow(/incompleta/);
  });

  it('fallisce quando il servizio risponde con un errore', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => risposta({}, false)),
    );
    await expect(fetchCurrentWeather()).rejects.toThrow(/503/);
  });

  it('fallisce quando la risposta non contiene i dati attuali', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => risposta({})),
    );
    await expect(fetchCurrentWeather()).rejects.toThrow(/non ha restituito/);
  });

  it('abbandona la richiesta quando chi chiama annulla', async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
          }),
      ),
    );

    const attesa = fetchCurrentWeather(abort.signal);
    abort.abort();
    await expect(attesa).rejects.toThrow();
  });
});
