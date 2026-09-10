/**
 * Le segnalazioni salvate: elenco, cancellazione, scambio con altri.
 *
 * Senza un server, il solo modo per far arrivare una segnalazione a qualcun
 * altro e' un file: si esporta, si manda, chi lo riceve lo importa. E' meno
 * comodo di un database condiviso ed e' l'unica cosa onesta che questa app
 * puo' fare senza diventare un'altra app.
 */
import { useRef, useState } from 'react';

import { downloadText } from '../../services/itinerary';
import {
  isStale,
  parseReports,
  reportAgeLabel,
  reportLook,
  serializeReports,
  REPORT_STALE_DAYS,
} from '../../services/reports';
import { useAppStore } from '../../store/useAppStore';
import { Notice } from '../UI';

export function ReportsPanel(): JSX.Element {
  const reports = useAppStore((s) => s.reports);
  const persisted = useAppStore((s) => s.reportsPersisted);
  const removeReport = useAppStore((s) => s.removeReport);
  const importReports = useAppStore((s) => s.importReports);
  const setPickingMode = useAppStore((s) => s.setPickingMode);
  const pickingMode = useAppStore((s) => s.pickingMode);
  const setFocusPoint = useAppStore((s) => s.setFocusPoint);

  const fileInput = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const esporta = (): void => {
    downloadText(
      `segnalazioni-bicipesaro-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
      serializeReports(reports),
    );
    setFeedback('File salvato: puoi inviarlo a chi vuoi, e potrà importarlo qui.');
    setErrore(null);
  };

  const importa = async (file: File): Promise<void> => {
    let testo: string;
    try {
      testo = await file.text();
    } catch {
      setErrore('Non è stato possibile leggere il file selezionato.');
      return;
    }

    const esito = parseReports(testo);
    if (!esito.ok) {
      setErrore(esito.message);
      setFeedback(null);
      return;
    }

    const aggiunte = importReports(esito.reports);
    setErrore(null);
    setFeedback(
      `${aggiunte} ${aggiunte === 1 ? 'segnalazione importata' : 'segnalazioni importate'}` +
        (esito.reports.length - aggiunte > 0
          ? `, ${esito.reports.length - aggiunte} già presenti`
          : '') +
        (esito.scartate > 0 ? `. ${esito.scartate} voci illeggibili sono state scartate` : '') +
        '.',
    );
  };

  return (
    <section className="panel-section">
      <h2 className="panel-title">Segnalazioni ({reports.length})</h2>

      <button
        type="button"
        className={`btn btn--block btn--sm ${pickingMode === 'report' ? 'btn--primary' : 'btn--subtle'}`}
        onClick={() => setPickingMode(pickingMode === 'report' ? null : 'report')}
        aria-pressed={pickingMode === 'report'}
      >
        {pickingMode === 'report' ? '📍 Tocca il punto sulla mappa…' : '📌 Segnala un punto'}
      </button>

      {!persisted ? (
        <div style={{ marginTop: 10 }}>
          <Notice variant="warning" icon="⚠️">
            Il browser non permette di salvare dati su questo dispositivo (succede in
            navigazione privata): le segnalazioni spariranno chiudendo la pagina. Esportale se
            vuoi conservarle.
          </Notice>
        </div>
      ) : null}

      {reports.length === 0 ? (
        <p className="reports__empty">
          Nessuna segnalazione. Tocca «Segnala un punto» e poi la mappa per aggiungere una buca,
          un cantiere o un punto utile. Restano su questo dispositivo e le rivedi al prossimo
          giro.
        </p>
      ) : (
        <ul className="reports__list">
          {reports.map((report) => {
            const look = reportLook(report.type);
            const vecchia = isStale(report);
            return (
              <li key={report.id} className="reports__item">
                <span className="reports__icon" style={{ background: `${look.color}22` }}>
                  {look.icon}
                </span>
                <div className="reports__body">
                  <button
                    type="button"
                    className="reports__label"
                    onClick={() => setFocusPoint([report.lng, report.lat])}
                    title="Mostra sulla mappa"
                  >
                    {look.label}
                  </button>
                  {report.note ? <p className="reports__note">{report.note}</p> : null}
                  <p className="reports__meta">
                    {reportAgeLabel(report)}
                    {vecchia ? (
                      <span className="reports__stale">
                        {' '}
                        · da verificare (più di {REPORT_STALE_DAYS} giorni)
                      </span>
                    ) : null}
                  </p>
                </div>
                <button
                  type="button"
                  className="reports__delete"
                  onClick={() => removeReport(report.id)}
                  aria-label={`Elimina la segnalazione «${look.label}»`}
                  title="Elimina"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="reports__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={esporta}
          disabled={reports.length === 0}
        >
          📤 Esporta
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => fileInput.current?.click()}
        >
          📥 Importa
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importa(file);
            event.target.value = '';
          }}
        />
      </div>

      {feedback ? <p className="reports__feedback">{feedback}</p> : null}
      {errore ? (
        <div style={{ marginTop: 8 }}>
          <Notice variant="danger" icon="⚠️">
            {errore}
          </Notice>
        </div>
      ) : null}

      {/*
        La distinzione fra i dati del progetto e quel che scrive chi pedala
        deve stare scritta, non solo suggerita dai colori sulla mappa.
      */}
      <p className="reports__disclaimer">
        Le segnalazioni non fanno parte dei dati GIS del progetto e non influenzano il calcolo
        dei percorsi: sono note tue, su questo dispositivo.
      </p>
    </section>
  );
}
