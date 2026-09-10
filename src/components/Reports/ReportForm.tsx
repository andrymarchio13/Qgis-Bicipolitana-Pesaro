/**
 * Scrivere una segnalazione nel punto toccato sulla mappa.
 *
 * Poche cose, tutte facoltative tranne il tipo: chi si ferma in bici per
 * segnalare una buca non compila un modulo. La data la mette l'app, le
 * coordinate vengono dal tocco.
 */
import { useState } from 'react';

import { REPORT_TYPES, createReport, type ReportType } from '../../services/reports';
import { useAppStore } from '../../store/useAppStore';
import type { LngLat } from '../../types';

export interface ReportFormProps {
  point: LngLat;
  onClose: () => void;
}

export function ReportForm({ point, onClose }: ReportFormProps): JSX.Element {
  const addReport = useAppStore((s) => s.addReport);
  const [type, setType] = useState<ReportType>('buca');
  const [note, setNote] = useState('');

  const salva = (): void => {
    addReport(createReport(type, point, note));
    onClose();
  };

  return (
    <section className="panel-section">
      <h2 className="panel-title">Nuova segnalazione</h2>

      <p className="report-form__where">
        📍 {point[1].toFixed(5)}, {point[0].toFixed(5)}
      </p>

      <div className="report-form__types" role="radiogroup" aria-label="Tipo di segnalazione">
        {REPORT_TYPES.map((option) => (
          <button
            key={option.type}
            type="button"
            role="radio"
            aria-checked={type === option.type}
            className={`report-form__type${type === option.type ? ' is-active' : ''}`}
            onClick={() => setType(option.type)}
            style={type === option.type ? { borderColor: option.color } : undefined}
          >
            <span aria-hidden="true">{option.icon}</span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>

      <label className="report-form__note">
        <span>Nota (facoltativa)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={280}
          rows={2}
          placeholder="Es. buca profonda sul lato destro, dopo il semaforo"
        />
      </label>

      {/*
        Va detto prima di salvare, non dopo: la segnalazione resta su questo
        dispositivo. Chi crede di avvisare il Comune e non lo sta facendo
        merita di saperlo adesso.
      */}
      <p className="report-form__disclaimer">
        Resta salvata <strong>su questo dispositivo</strong>: nessuno la riceve. Per farla
        arrivare a qualcuno, esportala dall’elenco delle segnalazioni; per avvisare chi può
        intervenire, usa il canale ufficiale del Comune.
      </p>

      <div className="report-form__actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={salva}>
          Salva segnalazione
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          Annulla
        </button>
      </div>
    </section>
  );
}
