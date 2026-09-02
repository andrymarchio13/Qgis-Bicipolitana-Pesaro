/** Pagine informative: progetto, dati, privacy, segnalazioni. */
import { REPORT_ISSUE_URL } from '../config';
import { Notice } from '../components/UI';
import { useAppStore } from '../store/useAppStore';

export function AboutPage(): JSX.Element {
  const data = useAppStore((s) => s.data);
  const graphIndex = useAppStore((s) => s.graphIndex);
  const metadata = data?.metadata;

  return (
    <>
      <section className="panel-section">
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Il progetto</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-700)' }}>
          Bicipolitana Pesaro è un navigatore ciclabile costruito sui dati del progetto GIS
          <strong> Pesaro2026</strong>, realizzato in QGIS. Le linee, i servizi, gli ostacoli e i
          punti di svago provengono da quel progetto: nessun elemento è stato inventato o
          sostituito con dati fittizi.
        </p>
      </section>

      {metadata ? (
        <section className="panel-section">
          <h2 className="panel-title">Dati e provenienza</h2>
          <dl style={{ margin: 0, display: 'grid', gap: 8, fontSize: 14 }}>
            <Row label="Progetto di origine" value={metadata.source} />
            <Row label="Sistema di riferimento originale" value={metadata.crsOriginal} />
            <Row label="Sistema usato sul web" value={metadata.webCrs} />
            <Row
              label="Ultimo aggiornamento dati"
              value={new Date(metadata.generatedAt).toLocaleString('it-IT')}
            />
            <Row label="Linee" value={String(metadata.counts.lines)} />
            <Row label="Servizi" value={String(metadata.counts.servizi)} />
            <Row label="Ostacoli" value={String(metadata.counts.ostacoli)} />
            <Row label="Punti di svago" value={String(metadata.counts.svago)} />
            {graphIndex ? (
              <>
                <Row label="Nodi del grafo" value={String(graphIndex.nodes.length)} />
                <Row label="Archi del grafo" value={String(graphIndex.edges.length)} />
              </>
            ) : null}
          </dl>

          <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Fonti</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink-700)' }}>
            {metadata.sources.map((source) => (
              <li key={source} style={{ marginBottom: 4 }}>
                {source}
              </li>
            ))}
          </ul>

          {metadata.excludedFeatures.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <Notice variant="warning" icon="⚠️">
                {metadata.excludedFeatures.length} elemento/i del dataset originale non sono
                utilizzabili e sono stati esclusi:{' '}
                {metadata.excludedFeatures
                  .map((f) => `feature ${f.feature}${f.line ? ` (linea ${f.line})` : ''}: ${f.reason}`)
                  .join('; ')}
                .
              </Notice>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel-section">
        <h2 className="panel-title">Come vengono stimati i tempi</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-700)' }}>
          I tempi mostrati sono <strong>stime</strong> calcolate a velocità media costante
          {metadata ? ` (${metadata.estimates.cyclingSpeedKmh} km/h)` : ''}, corrette dal tipo di
          fondo stradale quando il dato è presente in OpenStreetMap. Non tengono conto di
          pendenze — il progetto GIS non contiene un modello digitale del terreno — né di
          semafori, traffico o condizioni meteo.
        </p>
      </section>

      <section className="panel-section">
        <h2 className="panel-title">Cosa l’app non fa</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: 'var(--ink-700)' }}>
          <li style={{ marginBottom: 6 }}>
            Non mostra chiusure, lavori o interruzioni: non esiste una fonte ufficiale in tempo
            reale collegata a questo progetto.
          </li>
          <li style={{ marginBottom: 6 }}>
            Non dichiara un percorso “sicuro”: propone il percorso <em>più sicuro secondo i dati
            disponibili</em>, che restano una stima.
          </li>
          <li>Non conosce i nomi ufficiali delle linee finché non vengono inseriti da fonte verificabile.</li>
        </ul>
      </section>

      <ReportSection />

      <section className="attribution">
        © OpenStreetMap contributors · Basemap © CARTO · Dati GIS: progetto Pesaro2026 (QGIS).
        <br />
        Le mappe e i dati sono usati nel rispetto delle rispettive licenze.
      </section>
    </>
  );
}

export function PrivacyPage(): JSX.Element {
  return (
    <>
      <section className="panel-section">
        <h1 style={{ fontSize: 20, marginBottom: 10 }}>Privacy</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-700)', marginBottom: 12 }}>
          In breve: questa applicazione non ha account, non ha un server proprio e non raccoglie
          dati personali.
        </p>

        <h2 className="panel-title" style={{ marginTop: 18 }}>La tua posizione</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-700)' }}>
          La posizione GPS viene richiesta solo quando premi “La mia posizione” o avvii la
          navigazione. Resta nel tuo browser per il tempo della sessione, serve unicamente a
          calcolare e seguire il percorso, e <strong>non viene inviata ad alcun server né
          memorizzata</strong>. Puoi negare il permesso: l’app resta utilizzabile scegliendo i
          punti sulla mappa.
        </p>

        <h2 className="panel-title" style={{ marginTop: 18 }}>Servizi esterni</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-700)' }}>
          Le mattonelle della mappa e la ricerca degli indirizzi vengono richieste a servizi
          esterni (CARTO per lo sfondo cartografico, Nominatim/OpenStreetMap per la ricerca).
          Come per qualunque richiesta web, quei servizi ricevono il tuo indirizzo IP e il testo
          che cerchi. La ricerca funziona anche solo sui dati locali del progetto se il servizio
          esterno non è raggiungibile.
        </p>

        <h2 className="panel-title" style={{ marginTop: 18 }}>Memoria del browser</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-700)' }}>
          L’app installata come PWA conserva nella cache del browser i file dell’interfaccia e i
          dati GIS, per poter funzionare anche senza rete. Puoi rimuoverli in qualsiasi momento
          svuotando i dati del sito o disinstallando l’app.
        </p>
      </section>
    </>
  );
}

function ReportSection(): JSX.Element {
  return (
    <section className="panel-section">
      <h2 className="panel-title">Segnala un problema</h2>
      <p style={{ fontSize: 14, color: 'var(--ink-700)', marginBottom: 10 }}>
        Percorso interrotto, ostacolo non segnalato, fontanella non funzionante, dato errato:
        le segnalazioni aiutano a correggere i dati.
      </p>
      {REPORT_ISSUE_URL ? (
        <a
          className="btn btn--ghost btn--block btn--sm"
          href={REPORT_ISSUE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Apri il modulo di segnalazione ↗
        </a>
      ) : (
        <Notice variant="info" icon="ℹ️">
          Il canale di segnalazione non è ancora configurato. Va impostato in
          <code> VITE_REPORT_ISSUE_URL</code> (per esempio l’indirizzo delle issue del
          repository GitHub del progetto).
        </Notice>
      )}
      <p style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 10 }}>
        La segnalazione non raccoglie dati personali: descrivi il problema e, se puoi, indica il
        punto sulla mappa.
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <dt style={{ color: 'var(--ink-500)', minWidth: 190 }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}
