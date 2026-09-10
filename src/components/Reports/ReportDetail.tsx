/**
 * Una segnalazione toccata sulla mappa.
 *
 * Dice tre cose e nient'altro: cos'e', cosa ha scritto chi l'ha messa e
 * quando. La data non e' un dettaglio d'archivio — e' il motivo per cui ci
 * si puo' fidare o no di quello che c'e' scritto, e quando invecchia l'app
 * lo dichiara invece di lasciar credere che sia di ieri.
 */
import {
  isStale,
  reportAgeLabel,
  reportLook,
  REPORT_STALE_DAYS,
  type UserReport,
} from '../../services/reports';
import { Notice } from '../UI';

export interface ReportDetailProps {
  report: UserReport;
  onClose: () => void;
  onDelete: () => void;
}

export function ReportDetail({ report, onClose, onDelete }: ReportDetailProps): JSX.Element {
  const look = reportLook(report.type);
  const quando = new Date(report.createdAt);

  return (
    <section className="panel-section">
      <div className="report-detail__head">
        <span className="report-detail__icon" style={{ background: `${look.color}22` }}>
          {look.icon}
        </span>
        <h2 className="panel-title" style={{ margin: 0, flex: 1 }}>
          {look.label}
        </h2>
        <button type="button" className="reports__delete" onClick={onClose} aria-label="Chiudi">
          ✕
        </button>
      </div>

      {report.note ? <p className="report-detail__note">{report.note}</p> : null}

      <p className="reports__meta">
        Segnalata {reportAgeLabel(report)} · {quando.toLocaleDateString('it-IT')} ·{' '}
        {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
      </p>

      {isStale(report) ? (
        <Notice variant="warning" icon="⏳">
          Questa segnalazione ha più di {REPORT_STALE_DAYS} giorni: la situazione può essere
          cambiata. Se non è più valida, eliminala.
        </Notice>
      ) : null}

      <p className="reports__disclaimer">
        L’hai scritta tu su questo dispositivo: non fa parte dei dati del progetto e non cambia
        il calcolo dei percorsi.
      </p>

      <button type="button" className="btn btn--ghost btn--block btn--sm" onClick={onDelete}>
        🗑️ Elimina segnalazione
      </button>
    </section>
  );
}
