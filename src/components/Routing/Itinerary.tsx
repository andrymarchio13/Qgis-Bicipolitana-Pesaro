/**
 * Salvataggio su file dell'itinerario scelto e riapertura di un file salvato.
 *
 * Sono due comandi separati perche' vivono in due momenti diversi: si salva
 * dopo aver scelto un percorso fra le alternative, si importa all'inizio,
 * quando il modulo di ricerca e' ancora vuoto.
 */
import { useCallback, useRef, useState } from 'react';

import {
  buildItinerary,
  downloadText,
  itineraryFileName,
  ITINERARY_EXTENSION,
  readItineraryFile,
  serializeItinerary,
  toGpx,
} from '../../services/itinerary';
import { useAppStore } from '../../store/useAppStore';
import type { Route } from '../../types';
import { Notice } from '../UI';

// ---------------------------------------------------------------------------
// Esportazione
// ---------------------------------------------------------------------------

export interface ItineraryExportProps {
  route: Route;
}

export function ItineraryExport({ route }: ItineraryExportProps): JSX.Element {
  const origin = useAppStore((s) => s.origin);
  const destination = useAppStore((s) => s.destination);
  const [feedback, setFeedback] = useState<string | null>(null);

  const save = useCallback(
    (format: 'app' | 'gpx') => {
      const itinerary = buildItinerary(route, origin, destination);
      if (format === 'app') {
        downloadText(
          itineraryFileName(origin, destination, ITINERARY_EXTENSION),
          'application/json',
          serializeItinerary(itinerary),
        );
        setFeedback('Itinerario salvato. Puoi riaprirlo dalla schermata iniziale con «Apri itinerario».');
      } else {
        downloadText(
          itineraryFileName(origin, destination, 'gpx'),
          'application/gpx+xml',
          toGpx(itinerary),
        );
        setFeedback('Traccia GPX salvata: puoi caricarla su un ciclocomputer o su un’altra app.');
      }
    },
    [route, origin, destination],
  );

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn--subtle btn--sm"
          style={{ flex: '1 1 140px' }}
          onClick={() => save('app')}
          title="Salva questo itinerario in un file, per riaprirlo più avanti"
        >
          💾 Salva itinerario
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ flex: '1 1 140px' }}
          onClick={() => save('gpx')}
          title="Esporta la traccia in formato GPX, per usarla in un’altra applicazione"
        >
          📤 Esporta GPX
        </button>
      </div>

      {feedback ? (
        <p style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 8 }}>{feedback}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Importazione
// ---------------------------------------------------------------------------

export function ItineraryImport(): JSX.Element {
  const importItinerary = useAppStore((s) => s.importItinerary);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const result = await readItineraryFile(file);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      importItinerary(result.itinerary);
    },
    [importItinerary],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        // Il GPX non compare fra i formati accettati: e' un'esportazione, non
        // un formato che l'app sappia riaprire con le sue indicazioni.
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Il campo si svuota subito, altrimenti riscegliere lo stesso file
          // non farebbe scattare l'evento una seconda volta.
          event.target.value = '';
          void handleFile(file);
        }}
      />

      <button
        type="button"
        className="btn btn--ghost btn--block btn--sm"
        style={{ marginTop: 10 }}
        onClick={() => inputRef.current?.click()}
      >
        📂 Apri itinerario salvato
      </button>

      {error ? (
        <div style={{ marginTop: 10 }}>
          <Notice variant="danger" icon="⚠️">
            {error}
          </Notice>
        </div>
      ) : null}
    </>
  );
}
