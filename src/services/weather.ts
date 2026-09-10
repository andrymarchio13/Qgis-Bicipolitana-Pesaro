/**
 * Meteo attuale di Pesaro.
 *
 * I dati vengono da Open-Meteo: gratuito, senza chiave e senza registrazione,
 * quindi non rompe la regola del progetto — l'app si pubblica su GitHub Pages
 * senza backend e senza segreti. La licenza dei dati (CC BY 4.0) richiede
 * l'attribuzione, che l'interfaccia mostra e non permette di togliere.
 *
 * Vale anche qui la regola sui dati: nulla viene inventato. Se il servizio non
 * risponde non si mostra l'ultimo valore come se fosse attuale — si dice che
 * il meteo non e' disponibile, e quando si mostra un valore si dichiara a che
 * ora e' stato misurato.
 *
 * Per un ciclista non conta solo la temperatura: il vento e la pioggia
 * cambiano il viaggio piu' di qualsiasi altra cosa, e sono in primo piano.
 */
import {
  PESARO_CENTER,
  WEATHER_FORECAST_HOURS,
  WEATHER_TIMEOUT_MS,
  WEATHER_URL,
} from '../config';

export interface CurrentWeather {
  /** Temperatura in gradi Celsius. */
  temperature: number;
  /** Temperatura percepita: con vento e umidita' e' quella che si sente. */
  apparentTemperature: number | null;
  /** Velocita' del vento in km/h. */
  windSpeed: number | null;
  /** Direzione da cui soffia il vento, in gradi. */
  windDirection: number | null;
  /** Precipitazione dell'ultima ora in millimetri. */
  precipitation: number | null;
  /** Codice meteo WMO 4677, dal quale derivano descrizione e simbolo. */
  code: number;
  /** true di notte: cambia il simbolo del sereno. */
  night: boolean;
  /** Istante della misura dichiarato dal servizio. */
  measuredAt: Date;
}

/** Una delle prossime ore: quel che serve per decidere quando uscire. */
export interface HourForecast {
  time: Date;
  temperature: number | null;
  /** Probabilita' di pioggia dichiarata dal servizio, 0..100. */
  rainChance: number | null;
  /** Millimetri previsti in quell'ora. */
  precipitation: number | null;
  windSpeed: number | null;
  code: number | null;
}

/**
 * Meteo attuale, prossime ore e luce del giorno.
 *
 * Le tre cose arrivano in un'unica richiesta: sono lo stesso servizio, e
 * chiederle separatamente triplicherebbe il traffico senza aggiungere nulla.
 */
export interface WeatherReport {
  current: CurrentWeather;
  /** Le prossime ore in ordine, a partire da quella in corso. */
  hours: HourForecast[];
  /** Alba e tramonto di oggi, dichiarati dal servizio per Pesaro. */
  sunrise: Date | null;
  sunset: Date | null;
}

/**
 * Quando smette o quando comincia a piovere.
 *
 * Non e' una previsione nostra: e' la lettura delle ore che il servizio
 * dichiara. Se le ore non bastano a rispondere, si tace invece di estrapolare.
 */
export interface RainWindow {
  /** true se nell'ora in corso il servizio prevede pioggia. */
  rainingNow: boolean;
  /** Prima ora asciutta dopo la pioggia, se c'e' nelle ore disponibili. */
  dryFrom: Date | null;
  /** Prima ora di pioggia, se arriva nelle ore disponibili. */
  rainFrom: Date | null;
  /** Probabilita' massima nelle ore considerate. */
  peakChance: number | null;
}

/**
 * Sopra questa probabilita' l'ora viene considerata "con pioggia".
 *
 * E' una soglia di lettura dichiarata, non un dato: sotto il 30% il servizio
 * segnala una possibilita' remota, e trattarla come pioggia terrebbe a casa
 * chi poteva uscire tranquillamente.
 */
export const RAIN_CHANCE_THRESHOLD = 30;

/**
 * Legge le prossime ore e dice quando piove.
 *
 * `hours` deve essere in ordine di tempo, a partire dall'ora in corso.
 */
export function rainWindow(hours: HourForecast[]): RainWindow | null {
  const usable = hours.filter((h) => h.rainChance !== null || h.precipitation !== null);
  if (usable.length === 0) return null;

  const wet = (hour: HourForecast): boolean =>
    (hour.rainChance ?? 0) >= RAIN_CHANCE_THRESHOLD || (hour.precipitation ?? 0) >= 0.2;

  const rainingNow = wet(usable[0]!);
  const chances = usable.map((h) => h.rainChance).filter((c): c is number => c !== null);

  return {
    rainingNow,
    dryFrom: rainingNow ? (usable.find((h) => !wet(h))?.time ?? null) : null,
    rainFrom: rainingNow ? null : (usable.find(wet)?.time ?? null),
    peakChance: chances.length > 0 ? Math.max(...chances) : null,
  };
}

/**
 * Descrizione e simbolo dei codici meteo WMO usati da Open-Meteo.
 *
 * La tabella e' quella dello standard, non un'interpretazione: i codici non
 * coperti ricadono su un testo che dichiara di non saperli tradurre, invece di
 * inventare una descrizione plausibile.
 */
const WMO: Record<number, { text: string; icon: string; nightIcon?: string }> = {
  0: { text: 'Sereno', icon: '☀️', nightIcon: '🌙' },
  1: { text: 'Prevalentemente sereno', icon: '🌤️', nightIcon: '🌙' },
  2: { text: 'Parzialmente nuvoloso', icon: '⛅', nightIcon: '☁️' },
  3: { text: 'Coperto', icon: '☁️' },
  45: { text: 'Nebbia', icon: '🌫️' },
  48: { text: 'Nebbia con brina', icon: '🌫️' },
  51: { text: 'Pioviggine leggera', icon: '🌦️' },
  53: { text: 'Pioviggine', icon: '🌦️' },
  55: { text: 'Pioviggine intensa', icon: '🌧️' },
  56: { text: 'Pioviggine gelata', icon: '🌧️' },
  57: { text: 'Pioviggine gelata intensa', icon: '🌧️' },
  61: { text: 'Pioggia leggera', icon: '🌦️' },
  63: { text: 'Pioggia', icon: '🌧️' },
  65: { text: 'Pioggia forte', icon: '🌧️' },
  66: { text: 'Pioggia gelata', icon: '🌧️' },
  67: { text: 'Pioggia gelata forte', icon: '🌧️' },
  71: { text: 'Neve leggera', icon: '🌨️' },
  73: { text: 'Neve', icon: '🌨️' },
  75: { text: 'Neve forte', icon: '❄️' },
  77: { text: 'Granuli di neve', icon: '🌨️' },
  80: { text: 'Rovesci leggeri', icon: '🌦️' },
  81: { text: 'Rovesci', icon: '🌧️' },
  82: { text: 'Rovesci violenti', icon: '⛈️' },
  85: { text: 'Rovesci di neve', icon: '🌨️' },
  86: { text: 'Rovesci di neve forti', icon: '❄️' },
  95: { text: 'Temporale', icon: '⛈️' },
  96: { text: 'Temporale con grandine', icon: '⛈️' },
  99: { text: 'Temporale con grandine forte', icon: '⛈️' },
};

export interface WeatherLook {
  text: string;
  icon: string;
}

/** Descrizione e simbolo di un codice WMO. */
export function describeWeather(code: number, night = false): WeatherLook {
  const entry = WMO[code];
  if (!entry) {
    // Un codice fuori tabella non viene tradotto a caso: si dichiara.
    return { text: 'Condizioni non riconosciute', icon: '❓' };
  }
  return { text: entry.text, icon: night && entry.nightIcon ? entry.nightIcon : entry.icon };
}

/** I sedici punti della rosa dei venti, per dire da dove soffia. */
const ROSA = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO',
];

/** Direzione del vento come punto cardinale: "NE" si legge meglio di "43°". */
export function windCardinal(degrees: number | null): string | null {
  if (degrees === null || !Number.isFinite(degrees)) return null;
  return ROSA[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/**
 * Quanto il vento conta per chi pedala.
 *
 * Le soglie sono una lettura dichiarata della scala Beaufort, non una misura:
 * sopra i 20 km/h il vento contrario si sente in modo netto, sopra i 38 rende
 * faticoso anche il piano.
 */
export function windNote(speedKmh: number | null): string | null {
  if (speedKmh === null || !Number.isFinite(speedKmh)) return null;
  if (speedKmh < 12) return null;
  if (speedKmh < 20) return 'Brezza: si pedala bene.';
  if (speedKmh < 38) return 'Vento teso: controvento si fa sentire.';
  return 'Vento forte: pedalata faticosa anche in piano.';
}

/** true quando il codice indica precipitazioni in corso. */
export function isWet(code: number): boolean {
  return code >= 51;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Legge un istante dichiarato dal servizio, o null se non e' leggibile. */
const dateOrNull = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Estrae le prossime ore dagli array paralleli di Open-Meteo. */
function readHours(hourly: Record<string, unknown> | undefined, from: Date): HourForecast[] {
  const times = Array.isArray(hourly?.time) ? (hourly.time as unknown[]) : [];
  if (times.length === 0) return [];

  const at = (key: string, index: number): number | null => {
    const column = hourly?.[key];
    return Array.isArray(column) ? numberOrNull(column[index]) : null;
  };

  /*
   * Si parte dall'ora in corso, non da quella dopo: se sono le 9:40 l'ora
   * delle 9 e' ancora quella che si sta vivendo. Il riferimento e' l'istante
   * dichiarato dal servizio, non l'orologio del dispositivo, che puo' essere
   * su un altro fuso o semplicemente sbagliato.
   */
  const since = new Date(from);
  since.setMinutes(0, 0, 0);

  const hours: HourForecast[] = [];
  for (let i = 0; i < times.length; i += 1) {
    const time = dateOrNull(times[i]);
    if (!time || time.getTime() < since.getTime()) continue;
    hours.push({
      time,
      temperature: at('temperature_2m', i),
      rainChance: at('precipitation_probability', i),
      precipitation: at('precipitation', i),
      windSpeed: at('wind_speed_10m', i),
      code: at('weather_code', i),
    });
    if (hours.length >= WEATHER_FORECAST_HOURS) break;
  }
  return hours;
}


/**
 * Interroga il servizio.
 *
 * Un errore non viene addolcito: chi chiama deve poter dire "meteo non
 * disponibile" invece di mostrare un valore vecchio spacciato per attuale.
 *
 * Meteo attuale, prossime ore e orari di alba e tramonto arrivano insieme:
 * e' una sola richiesta, e le tre cose servono nello stesso momento — che
 * tempo fa, se sta per piovere, e se si torna con la luce.
 */
export async function fetchWeatherReport(signal?: AbortSignal): Promise<WeatherReport> {
  const [lng, lat] = PESARO_CENTER;
  const url = new URL(WEATHER_URL);
  url.searchParams.set('latitude', lat.toFixed(4));
  url.searchParams.set('longitude', lng.toFixed(4));
  url.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day',
  );
  url.searchParams.set(
    'hourly',
    'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m',
  );
  url.searchParams.set('daily', 'sunrise,sunset');
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('timezone', 'Europe/Rome');

  /*
   * Doppio guinzaglio: quello di chi chiama, che annulla la richiesta quando
   * la schermata sparisce, e un tempo massimo perche' una risposta che non
   * arriva non lasci l'indicatore a girare per sempre.
   */
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), WEATHER_TIMEOUT_MS);
  const onAbort = (): void => timeout.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(url.toString(), { signal: timeout.signal });
    if (!response.ok) {
      throw new Error(`Il servizio meteo ha risposto ${response.status}.`);
    }
    const body = (await response.json()) as {
      current?: Record<string, unknown>;
      hourly?: Record<string, unknown>;
      daily?: Record<string, unknown>;
    };
    const current = body.current;
    if (!current) throw new Error('Il servizio meteo non ha restituito i dati attuali.');

    const temperature = numberOrNull(current.temperature_2m);
    const code = numberOrNull(current.weather_code);
    if (temperature === null || code === null) {
      throw new Error('Il servizio meteo ha restituito una risposta incompleta.');
    }

    const measuredAt = dateOrNull(current.time) ?? new Date();
    const daily = body.daily;
    const firstOf = (key: string): Date | null => {
      const column = daily?.[key];
      return Array.isArray(column) ? dateOrNull(column[0]) : null;
    };

    return {
      current: {
        temperature,
        apparentTemperature: numberOrNull(current.apparent_temperature),
        windSpeed: numberOrNull(current.wind_speed_10m),
        windDirection: numberOrNull(current.wind_direction_10m),
        precipitation: numberOrNull(current.precipitation),
        code,
        night: current.is_day === 0,
        measuredAt,
      },
      hours: readHours(body.hourly, measuredAt),
      sunrise: firstOf('sunrise'),
      sunset: firstOf('sunset'),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
