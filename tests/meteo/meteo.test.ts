/** Test del meteo: lettura dei codici WMO, vento e risposte del servizio. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describeWeather,
  fetchWeatherReport,
  isWet,
  rainWindow,
  windCardinal,
  windNote,
  type HourForecast,
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

    const { current } = await fetchWeatherReport();

    expect(current.temperature).toBe(21.4);
    expect(current.windSpeed).toBe(14.2);
    expect(current.code).toBe(2);
    expect(current.night).toBe(false);
    expect(current.measuredAt.getHours()).toBe(9);

    // Le richieste sono due (meteo e aria) e partono insieme: si cerca
    // quella del meteo invece di dare per scontato l'ordine.
    const chiamata = fetchMock.mock.calls
      .map((call) => call[0])
      .find((value) => !value.includes('air-quality'));
    const url = new URL(chiamata!);
    expect(url.searchParams.get('timezone')).toBe('Europe/Rome');
    expect(url.searchParams.get('current')).toContain('wind_speed_10m');
    // Ore e tramonto viaggiano nella stessa richiesta, non in una seconda.
    expect(url.searchParams.get('hourly')).toContain('precipitation_probability');
    expect(url.searchParams.get('daily')).toContain('sunset');
  });

  it('lascia a null i valori che il servizio non manda, senza stimarli', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        risposta({ current: { time: attuale.time, temperature_2m: 18, weather_code: 0 } }),
      ),
    );

    const { current } = await fetchWeatherReport();

    expect(current.windSpeed).toBeNull();
    expect(current.apparentTemperature).toBeNull();
    expect(current.precipitation).toBeNull();
  });

  it('segnala la notte quando il servizio la dichiara', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => risposta({ current: { ...attuale, is_day: 0 } })),
    );
    expect((await fetchWeatherReport()).current.night).toBe(true);
  });

  it('fallisce invece di restituire un meteo incompleto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => risposta({ current: { time: attuale.time, weather_code: 1 } })),
    );
    await expect(fetchWeatherReport()).rejects.toThrow(/incompleta/);
  });

  it('fallisce quando il servizio risponde con un errore', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => risposta({}, false)),
    );
    await expect(fetchWeatherReport()).rejects.toThrow(/503/);
  });

  it('fallisce quando la risposta non contiene i dati attuali', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => risposta({})),
    );
    await expect(fetchWeatherReport()).rejects.toThrow(/non ha restituito/);
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

    const attesa = fetchWeatherReport(abort.signal);
    abort.abort();
    await expect(attesa).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Prossime ore e tramonto
// ---------------------------------------------------------------------------

const ora = (h: number, rainChance: number | null, precipitation = 0): HourForecast => ({
  time: new Date(2026, 8, 10, h, 0, 0),
  temperature: 20,
  rainChance,
  precipitation,
  windSpeed: 10,
  code: 3,
});

describe('finestra di pioggia', () => {
  it('dice fino a quando resta asciutto', () => {
    const finestra = rainWindow([ora(9, 5), ora(10, 10), ora(11, 80), ora(12, 90)]);
    expect(finestra?.rainingNow).toBe(false);
    expect(finestra?.rainFrom?.getHours()).toBe(11);
    expect(finestra?.peakChance).toBe(90);
  });

  it('quando piove dice da quando torna asciutto', () => {
    const finestra = rainWindow([ora(9, 85), ora(10, 60), ora(11, 10)]);
    expect(finestra?.rainingNow).toBe(true);
    expect(finestra?.dryFrom?.getHours()).toBe(11);
    expect(finestra?.rainFrom).toBeNull();
  });

  it('non promette asciutto oltre le ore che conosce', () => {
    const finestra = rainWindow([ora(9, 90), ora(10, 80)]);
    expect(finestra?.rainingNow).toBe(true);
    expect(finestra?.dryFrom).toBeNull();
  });

  it('considera piovosa un ora con pioggia dichiarata anche senza probabilita', () => {
    const finestra = rainWindow([ora(9, null, 1.4)]);
    expect(finestra?.rainingNow).toBe(true);
  });

  it('tace quando il servizio non manda nessuna delle due informazioni', () => {
    expect(rainWindow([])).toBeNull();
    expect(rainWindow([{ ...ora(9, null), precipitation: null }])).toBeNull();
  });

  it('non tratta come pioggia una possibilita remota', () => {
    const finestra = rainWindow([ora(9, 20), ora(10, 25)]);
    expect(finestra?.rainingNow).toBe(false);
    expect(finestra?.rainFrom).toBeNull();
  });
});

describe('lettura delle ore e del tramonto dalla risposta', () => {
  it('tiene le ore da quella in corso in poi e legge il tramonto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        risposta({
          current: attuale,
          hourly: {
            time: ['2026-09-10T07:00', '2026-09-10T08:00', '2026-09-10T09:00', '2026-09-10T10:00'],
            temperature_2m: [16, 18, 21, 23],
            precipitation_probability: [0, 0, 10, 40],
            precipitation: [0, 0, 0, 0.3],
            weather_code: [0, 1, 2, 61],
            wind_speed_10m: [8, 10, 14, 16],
          },
          daily: { sunrise: ['2026-09-10T06:44'], sunset: ['2026-09-10T19:32'] },
        }),
      ),
    );

    const report = await fetchWeatherReport();

    // L'ora in corso e' le 9: le 7 e le 8 sono passate e non servono piu'.
    expect(report.hours.map((h) => h.time.getHours())).toEqual([9, 10]);
    expect(report.hours[0]!.rainChance).toBe(10);
    expect(report.sunset?.getHours()).toBe(19);
    expect(report.sunset?.getMinutes()).toBe(32);
    expect(report.sunrise?.getHours()).toBe(6);
  });

  it('senza ore e senza tramonto resta il meteo attuale, non un errore', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => risposta({ current: attuale })),
    );

    const report = await fetchWeatherReport();

    expect(report.current.temperature).toBe(21.4);
    expect(report.hours).toEqual([]);
    expect(report.sunset).toBeNull();
  });

  it('non inventa una probabilita quando la colonna manca', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        risposta({
          current: attuale,
          hourly: { time: ['2026-09-10T09:00'], temperature_2m: [21] },
        }),
      ),
    );

    const report = await fetchWeatherReport();
    expect(report.hours[0]!.rainChance).toBeNull();
    expect(report.hours[0]!.temperature).toBe(21);
  });
});
