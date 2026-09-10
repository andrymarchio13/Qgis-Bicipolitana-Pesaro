/**
 * Test delle segnalazioni scritte da chi usa l'app.
 *
 * Sono l'unico dato che l'applicazione non prende dal progetto ma dalle
 * persone: per questo i test insistono sulla validazione (quel che arriva da
 * `localStorage` o da un file puo' essere qualsiasi cosa) e sulla data, che
 * e' cio' che rende una segnalazione verificabile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REPORTS_FILE_KIND,
  REPORTS_STORAGE_KEY,
  REPORT_STALE_DAYS,
  createReport,
  isStale,
  isUserReport,
  loadReports,
  mergeReports,
  parseReports,
  reportAgeDays,
  reportAgeLabel,
  reportLook,
  saveReports,
  serializeReports,
  type UserReport,
} from '../../src/services/reports';

const PUNTO: [number, number] = [12.9089, 43.9061];

/** Un `localStorage` finto: i test girano in Node, dove non esiste. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Creazione
// ---------------------------------------------------------------------------

describe('creare una segnalazione', () => {
  it('registra tipo, posizione e momento', () => {
    const quando = new Date(2026, 8, 10, 14, 30);
    const report = createReport('buca', PUNTO, 'Buca profonda', quando);

    expect(report.type).toBe('buca');
    expect(report.lng).toBe(PUNTO[0]);
    expect(report.lat).toBe(PUNTO[1]);
    expect(report.note).toBe('Buca profonda');
    expect(new Date(report.createdAt).getTime()).toBe(quando.getTime());
  });

  it('dà a ciascuna un identificatore diverso', () => {
    const a = createReport('buca', PUNTO);
    const b = createReport('buca', PUNTO);
    expect(a.id).not.toBe(b.id);
  });

  it('taglia una nota lunghissima invece di salvarla intera', () => {
    const report = createReport('pericolo', PUNTO, 'x'.repeat(500));
    expect(report.note.length).toBe(280);
  });

  it('un tipo sconosciuto non fa sparire il segno dalla mappa', () => {
    const look = reportLook('inventato' as UserReport['type']);
    expect(look.icon).toBeTruthy();
    expect(look.color).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

describe('validazione di quel che arriva da fuori', () => {
  const valida = createReport('cantiere', PUNTO, 'Lavori');

  it('accetta una segnalazione completa', () => {
    expect(isUserReport(valida)).toBe(true);
  });

  it('rifiuta coordinate mancanti o impossibili', () => {
    expect(isUserReport({ ...valida, lat: undefined })).toBe(false);
    expect(isUserReport({ ...valida, lat: 120 })).toBe(false);
    expect(isUserReport({ ...valida, lng: Number.NaN })).toBe(false);
  });

  it('rifiuta una data che non è una data', () => {
    expect(isUserReport({ ...valida, createdAt: 'l’altro ieri' })).toBe(false);
  });

  it('rifiuta oggetti che non c’entrano nulla', () => {
    expect(isUserReport(null)).toBe(false);
    expect(isUserReport('buca')).toBe(false);
    expect(isUserReport({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Deposito locale
// ---------------------------------------------------------------------------

describe('deposito sul dispositivo', () => {
  it('salva e rilegge le segnalazioni', () => {
    const reports = [createReport('buca', PUNTO), createReport('utile', PUNTO, 'Bella vista')];
    expect(saveReports(reports)).toBe(true);
    expect(loadReports()).toEqual(reports);
  });

  it('riparte da zero se non c’è nulla salvato', () => {
    expect(loadReports()).toEqual([]);
  });

  it('scarta le voci corrotte invece di mostrarle a metà', () => {
    const buona = createReport('buca', PUNTO);
    localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify([buona, { id: 'x' }, null]));
    expect(loadReports()).toEqual([buona]);
  });

  it('sopravvive a un contenuto illeggibile', () => {
    localStorage.setItem(REPORTS_STORAGE_KEY, 'non è json');
    expect(loadReports()).toEqual([]);
  });

  it('non si rompe quando il browser vieta di scrivere', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('negato');
      },
      setItem: () => {
        throw new Error('negato');
      },
    } as unknown as Storage);

    expect(saveReports([createReport('buca', PUNTO)])).toBe(false);
    expect(loadReports()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invecchiamento
// ---------------------------------------------------------------------------

describe('quanto è vecchia una segnalazione', () => {
  const scritta = (giorniFa: number): UserReport =>
    createReport('buca', PUNTO, '', new Date(2026, 8, 10 - giorniFa, 12, 0));
  const oggi = new Date(2026, 8, 10, 12, 0);

  it('conta i giorni passati', () => {
    expect(reportAgeDays(scritta(0), oggi)).toBe(0);
    expect(reportAgeDays(scritta(5), oggi)).toBe(5);
  });

  it('lo dice come lo direbbe una persona', () => {
    expect(reportAgeLabel(scritta(0), oggi)).toBe('oggi');
    expect(reportAgeLabel(scritta(1), oggi)).toBe('ieri');
    expect(reportAgeLabel(scritta(12), oggi)).toBe('12 giorni fa');
    expect(reportAgeLabel(scritta(40), oggi)).toBe('un mese fa');
  });

  it('oltre la soglia chiede di verificarla, ma non la cancella', () => {
    expect(isStale(scritta(REPORT_STALE_DAYS - 1), oggi)).toBe(false);
    expect(isStale(scritta(REPORT_STALE_DAYS + 1), oggi)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scambio con altri
// ---------------------------------------------------------------------------

describe('esportare e importare', () => {
  it('un file esportato si rilegge identico', () => {
    const reports = [createReport('buca', PUNTO, 'Sul lato destro')];
    const esito = parseReports(serializeReports(reports));

    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.reports).toEqual(reports);
    expect(esito.scartate).toBe(0);
  });

  it('rifiuta un file di un’altra applicazione', () => {
    const esito = parseReports(JSON.stringify({ kind: 'qualcos-altro', reports: [] }));
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.message).toContain('non contiene segnalazioni');
  });

  it('rifiuta un formato più recente invece di leggerlo a metà', () => {
    const esito = parseReports(
      JSON.stringify({ kind: REPORTS_FILE_KIND, version: 99, reports: [] }),
    );
    expect(esito.ok).toBe(false);
  });

  it('rifiuta un file illeggibile', () => {
    expect(parseReports('{{{').ok).toBe(false);
  });

  it('dichiara quante voci ha dovuto scartare', () => {
    const buona = createReport('buca', PUNTO);
    const esito = parseReports(
      JSON.stringify({
        kind: REPORTS_FILE_KIND,
        version: 1,
        exportedAt: new Date().toISOString(),
        reports: [buona, { id: 'rotta' }],
      }),
    );

    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.reports).toHaveLength(1);
    expect(esito.scartate).toBe(1);
  });
});

describe('unire le segnalazioni importate alle proprie', () => {
  it('aggiunge quelle nuove e conta quante ne ha aggiunte', () => {
    const mie = [createReport('buca', PUNTO)];
    const altrui = [createReport('cantiere', PUNTO)];
    const esito = mergeReports(mie, altrui);

    expect(esito.added).toBe(1);
    expect(esito.reports).toHaveLength(2);
  });

  it('importare due volte lo stesso file non crea doppioni', () => {
    const mie = [createReport('buca', PUNTO)];
    const primo = mergeReports(mie, mie);
    const secondo = mergeReports(primo.reports, mie);

    expect(primo.added).toBe(0);
    expect(secondo.reports).toHaveLength(1);
  });

  it('non sovrascrive una propria segnalazione con quella del file', () => {
    const mia = createReport('buca', PUNTO, 'la mia nota');
    const stessoId: UserReport = { ...mia, note: 'nota di un altro' };
    const esito = mergeReports([mia], [stessoId]);

    expect(esito.reports).toHaveLength(1);
    expect(esito.reports[0]!.note).toBe('la mia nota');
  });
});
