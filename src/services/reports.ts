/**
 * Segnalazioni di chi pedala.
 *
 * Una buca, un cantiere, un cancello nuovo, una fontanella che non funziona:
 * cose che i dati GIS non sanno perche' sono successe dopo il rilievo. Qui
 * chi usa l'app le mette sulla mappa e le ritrova al prossimo giro.
 *
 * DOVE VIVONO. Nel browser di chi le scrive (`localStorage`), e da nessuna
 * altra parte. Il progetto si pubblica su GitHub Pages senza backend e senza
 * chiavi: non c'e' un server a cui mandarle, e inventarne uno cambierebbe la
 * natura del progetto. La conseguenza va detta all'utente e non nascosta —
 * le segnalazioni sono **sue**, restano sul suo dispositivo, e per farle
 * arrivare a qualcun altro si esporta un file. Il Comune si avvisa con il
 * canale ufficiale (`VITE_REPORT_ISSUE_URL`), non con questa mappa.
 *
 * DATI DICHIARATI. Una segnalazione non e' un dato rilevato: e' l'opinione di
 * una persona in un certo giorno. Per questo porta sempre la data, l'app
 * mostra quanto e' vecchia, e sulla mappa non assomiglia mai a un punto del
 * GeoPackage. Non entra nel calcolo del percorso: cambiare di nascosto i
 * percorsi in base a una nota non verificata sarebbe la cosa peggiore che
 * questa funzione potrebbe fare.
 */
import type { LngLat } from '../types';

export type ReportType =
  | 'buca'
  | 'cantiere'
  | 'ostacolo'
  | 'pericolo'
  | 'fontanella_guasta'
  | 'utile';

export interface UserReport {
  id: string;
  type: ReportType;
  /** Nota libera di chi segnala. Puo' mancare: il tipo dice gia' molto. */
  note: string;
  lng: number;
  lat: number;
  /** Quando e' stata scritta, in ISO. */
  createdAt: string;
}

/** Come si presenta ogni tipo di segnalazione. */
export const REPORT_TYPES: {
  type: ReportType;
  label: string;
  icon: string;
  /** Colore del segno sulla mappa. */
  color: string;
}[] = [
  { type: 'buca', label: 'Buca o asfalto rotto', icon: '🕳️', color: '#b45309' },
  { type: 'cantiere', label: 'Cantiere o strada chiusa', icon: '🚧', color: '#ea580c' },
  { type: 'ostacolo', label: 'Ostacolo o barriera', icon: '⛔', color: '#dc2626' },
  { type: 'pericolo', label: 'Punto pericoloso', icon: '⚠️', color: '#d97706' },
  { type: 'fontanella_guasta', label: 'Fontanella guasta', icon: '🚱', color: '#0369a1' },
  { type: 'utile', label: 'Punto utile', icon: '⭐', color: '#15803d' },
];

const LOOK = new Map(REPORT_TYPES.map((t) => [t.type, t]));

/** Aspetto di un tipo; un tipo sconosciuto non manda in crisi la mappa. */
export function reportLook(type: ReportType): (typeof REPORT_TYPES)[number] {
  return LOOK.get(type) ?? { type, label: 'Segnalazione', icon: '📍', color: '#6b7280' };
}

/** Chiave in `localStorage`. Versionata: un formato futuro non legge questo. */
export const REPORTS_STORAGE_KEY = 'bicipesaro.reports.v1';

/** Marchio dei file esportati, come per gli itinerari. */
export const REPORTS_FILE_KIND = 'bicipesaro.reports';
export const REPORTS_FILE_VERSION = 1;

/**
 * Oltre questi giorni una segnalazione viene mostrata come "da verificare".
 *
 * Non viene cancellata: e' comunque la memoria di chi l'ha scritta. Ma dopo
 * tre mesi una buca puo' essere stata riparata, e presentarla come attuale
 * sarebbe la stessa disonestà che il progetto evita con il meteo vecchio.
 */
export const REPORT_STALE_DAYS = 90;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Verifica che un oggetto sia una segnalazione utilizzabile.
 *
 * Serve leggendo `localStorage` (che chiunque puo' modificare) e i file
 * importati: una voce malformata viene scartata, non mostrata a meta'.
 */
export function isUserReport(value: unknown): value is UserReport {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.type === 'string' &&
    typeof r.note === 'string' &&
    isFiniteNumber(r.lng) &&
    isFiniteNumber(r.lat) &&
    Math.abs(r.lat) <= 90 &&
    Math.abs(r.lng) <= 180 &&
    typeof r.createdAt === 'string' &&
    !Number.isNaN(new Date(r.createdAt).getTime())
  );
}

/** Un identificatore che non si ripete, anche senza `crypto.randomUUID`. */
function newId(): string {
  const globalCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof globalCrypto?.randomUUID === 'function') return globalCrypto.randomUUID();
  return `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Crea una segnalazione nel punto indicato. */
export function createReport(
  type: ReportType,
  point: LngLat,
  note = '',
  now = new Date(),
): UserReport {
  return {
    id: newId(),
    type,
    note: note.trim().slice(0, 280),
    lng: point[0],
    lat: point[1],
    createdAt: now.toISOString(),
  };
}

/** Da quanti giorni e' stata scritta. */
export function reportAgeDays(report: UserReport, now = new Date()): number {
  const days = (now.getTime() - new Date(report.createdAt).getTime()) / 86_400_000;
  return Math.max(0, Math.floor(days));
}

/** true quando e' abbastanza vecchia da meritare un «da verificare». */
export function isStale(report: UserReport, now = new Date()): boolean {
  return reportAgeDays(report, now) >= REPORT_STALE_DAYS;
}

/** Quanto e' vecchia, detto come lo direbbe una persona. */
export function reportAgeLabel(report: UserReport, now = new Date()): string {
  const days = reportAgeDays(report, now);
  if (days === 0) return 'oggi';
  if (days === 1) return 'ieri';
  if (days < 30) return `${days} giorni fa`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'un mese fa' : `${months} mesi fa`;
}

// ---------------------------------------------------------------------------
// Deposito locale
// ---------------------------------------------------------------------------

/**
 * Legge le segnalazioni salvate.
 *
 * Ogni accesso a `localStorage` puo' fallire — navigazione privata, spazio
 * esaurito, dati del sito cancellati — e in quel caso l'app non deve
 * rompersi: si riparte da un elenco vuoto.
 */
export function loadReports(): UserReport[] {
  try {
    const raw = localStorage.getItem(REPORTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isUserReport);
  } catch {
    return [];
  }
}

/** Salva l'elenco. Restituisce false se il browser non lo ha permesso. */
export function saveReports(reports: UserReport[]): boolean {
  try {
    localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scambio con altri: un file, perche' non c'e' un server
// ---------------------------------------------------------------------------

export interface ReportsFile {
  kind: typeof REPORTS_FILE_KIND;
  version: number;
  exportedAt: string;
  reports: UserReport[];
}

export function serializeReports(reports: UserReport[], now = new Date()): string {
  const file: ReportsFile = {
    kind: REPORTS_FILE_KIND,
    version: REPORTS_FILE_VERSION,
    exportedAt: now.toISOString(),
    reports,
  };
  return JSON.stringify(file, null, 2);
}

export type ReportsParseResult =
  | { ok: true; reports: UserReport[]; scartate: number }
  | { ok: false; message: string };

/**
 * Legge un file di segnalazioni.
 *
 * Le voci malformate vengono contate e dichiarate invece di sparire in
 * silenzio: chi importa deve sapere che il file conteneva qualcosa che l'app
 * non ha saputo leggere.
 */
export function parseReports(text: string): ReportsParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'Il file non è leggibile.' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'Il file non contiene segnalazioni.' };
  }

  const file = raw as Record<string, unknown>;
  if (file.kind !== REPORTS_FILE_KIND) {
    return { ok: false, message: 'Questo file non contiene segnalazioni della Bicipolitana.' };
  }
  if (file.version !== REPORTS_FILE_VERSION) {
    return {
      ok: false,
      message: `Il file è stato salvato con un'altra versione dell'app (formato ${String(
        file.version,
      )}) e non può essere aperto.`,
    };
  }
  if (!Array.isArray(file.reports)) {
    return { ok: false, message: 'Il file non contiene l’elenco delle segnalazioni.' };
  }

  const valide = file.reports.filter(isUserReport);
  return { ok: true, reports: valide, scartate: file.reports.length - valide.length };
}

/**
 * Unisce le segnalazioni importate a quelle gia' presenti.
 *
 * Chi importa due volte lo stesso file non si ritrova tutto doppio: le voci
 * con lo stesso id vengono riconosciute. Le proprie non vengono mai
 * sovrascritte da quelle di un file — in caso di conflitto vince cio' che
 * l'utente ha scritto sul proprio dispositivo.
 */
export function mergeReports(
  existing: UserReport[],
  incoming: UserReport[],
): { reports: UserReport[]; added: number } {
  const known = new Set(existing.map((r) => r.id));
  const nuove = incoming.filter((r) => !known.has(r.id));
  return {
    reports: [...existing, ...nuove].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    added: nuove.length,
  };
}
