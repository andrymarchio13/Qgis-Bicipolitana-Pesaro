/** Test della qualità dell'aria: fasce EAQI e tolleranza ai guasti. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { airQualityBand, fetchWeatherReport } from '../../src/services/weather';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fasce dell’indice europeo', () => {
  it('usa le soglie ufficiali EAQI', () => {
    expect(airQualityBand(0).label).toBe('Buona');
    expect(airQualityBand(19).label).toBe('Buona');
    expect(airQualityBand(20).label).toBe('Discreta');
    expect(airQualityBand(45).label).toBe('Media');
    expect(airQualityBand(70).label).toBe('Scarsa');
    expect(airQualityBand(95).label).toBe('Molto scarsa');
  });

  it('non lascia scoperti i valori oltre la scala', () => {
    expect(airQualityBand(250).label).toBe('Estremamente scarsa');
  });

  it('dà a ogni fascia un colore', () => {
    for (const index of [10, 30, 50, 70, 90, 150]) {
      expect(airQualityBand(index).color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Richiesta
// ---------------------------------------------------------------------------

const METEO = {
  current: {
    time: '2026-09-10T09:00',
    temperature_2m: 21,
    weather_code: 1,
    is_day: 1,
  },
};

/** Risponde al meteo e all'aria in base all'indirizzo chiamato. */
const fetchDoppio = (aria: unknown, ariaOk = true) =>
  vi.fn(async (url: string) => {
    const isAria = url.includes('air-quality');
    return {
      ok: isAria ? ariaOk : true,
      status: isAria && !ariaOk ? 500 : 200,
      json: async () => (isAria ? aria : METEO),
    } as Response;
  });

describe('lettura dell’aria', () => {
  it('legge indice e polveri dal servizio', async () => {
    vi.stubGlobal(
      'fetch',
      fetchDoppio({ current: { european_aqi: 34, pm2_5: 11.2, pm10: 18.4 } }),
    );

    const report = await fetchWeatherReport();

    expect(report.air?.index).toBe(34);
    expect(report.air?.label).toBe('Discreta');
    expect(report.air?.pm25).toBe(11.2);
  });

  it('se l’aria non risponde il meteo resta valido', async () => {
    vi.stubGlobal('fetch', fetchDoppio({}, false));

    const report = await fetchWeatherReport();

    expect(report.current.temperature).toBe(21);
    expect(report.air).toBeNull();
  });

  it('senza indice non inventa una fascia', async () => {
    vi.stubGlobal('fetch', fetchDoppio({ current: { pm2_5: 9 } }));
    expect((await fetchWeatherReport()).air).toBeNull();
  });

  it('chiede l’indice europeo e le polveri sottili', async () => {
    const fetchMock = fetchDoppio({ current: { european_aqi: 12 } });
    vi.stubGlobal('fetch', fetchMock);

    await fetchWeatherReport();

    const chiamata = fetchMock.mock.calls
      .map((c) => c[0])
      .find((url) => url.includes('air-quality'));
    expect(chiamata).toBeTruthy();
    const url = new URL(chiamata!);
    expect(url.searchParams.get('current')).toContain('european_aqi');
    expect(url.searchParams.get('current')).toContain('pm2_5');
  });
});
