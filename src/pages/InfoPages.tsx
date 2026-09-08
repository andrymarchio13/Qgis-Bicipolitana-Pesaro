/** Pagine informative: progetto e provenienza dei dati, privacy. */
import { REPORT_ISSUE_URL } from '../config';
import { useAppStore } from '../store/useAppStore';

export function AboutPage(): JSX.Element {
  const data = useAppStore((s) => s.data);
  const graphIndex = useAppStore((s) => s.graphIndex);
  const metadata = data?.metadata;
  const numero = (value: number): string => value.toLocaleString('it-IT');

  return (
    <>
      <section className="panel-section">
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Il progetto</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-700)' }}>
          Bicipolitana Pesaro è un navigatore ciclabile costruito sui dati del progetto GIS
          <strong> Pesaro2026</strong>, realizzato in QGIS. Tutto ciò che vedi sulla mappa viene
          da quei dati: nessun elemento è stato inventato o sostituito con dati fittizi.
        </p>
      </section>

      {metadata ? (
        <section className="panel-section">
          <h2 className="panel-title">Dati e provenienza</h2>
          <dl style={{ margin: 0, display: 'grid', gap: 8, fontSize: 14 }}>
            <Row
              label="Ultimo aggiornamento"
              value={new Date(metadata.generatedAt).toLocaleDateString('it-IT')}
            />
            <Row label="Linee" value={numero(metadata.counts.lines)} />
            <Row label="Servizi" value={numero(metadata.counts.servizi)} />
            <Row label="Ostacoli" value={numero(metadata.counts.ostacoli)} />
            <Row label="Punti di svago" value={numero(metadata.counts.svago)} />
            {graphIndex ? (
              <Row
                label="Rete per il calcolo"
                value={`${numero(graphIndex.nodes.length)} nodi · ${numero(graphIndex.edges.length)} archi`}
              />
            ) : null}
            <Row
              label="Sistema di riferimento"
              value={`${metadata.crsOriginal} (origine) → ${metadata.webCrs} (web)`}
            />
          </dl>

          <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Fonti</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink-700)' }}>
            {metadata.sources.map((source) => (
              <li key={source} style={{ marginBottom: 4 }}>
                {source}
              </li>
            ))}
          </ul>

          {/*
            Le geometrie inutilizzabili del dataset di origine si dichiarano invece
            di sparire in silenzio: è un dato sulla provenienza, non un avviso da
            mostrare come un problema, quindi sta in fondo e in piccolo.
          */}
          {metadata.excludedFeatures.length > 0 ? (
            <p style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 14 }}>
              {metadata.excludedFeatures.length === 1
                ? 'Un elemento del dataset di origine non è utilizzabile ed è escluso'
                : `${metadata.excludedFeatures.length} elementi del dataset di origine non sono utilizzabili e sono esclusi`}
              :{' '}
              {metadata.excludedFeatures
                .map((f) => `${f.line ? `linea ${f.line}, ` : ''}${f.reason}`)
                .join('; ')}
              .
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="panel-section">
        <h2 className="panel-title">Come vengono stimati i tempi</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-700)' }}>
          I tempi sono <strong>stime</strong> a velocità media costante
          {metadata ? ` (${metadata.estimates.cyclingSpeedKmh} km/h)` : ''}, corrette dal tipo di
          fondo stradale quando OpenStreetMap lo dichiara. Non tengono conto di pendenze — il
          progetto GIS non contiene un modello del terreno — né di semafori, traffico o meteo.
        </p>
      </section>

      <section className="panel-section">
        <h2 className="panel-title">Limiti dichiarati</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: 'var(--ink-700)' }}>
          <li style={{ marginBottom: 6 }}>
            Chiusure, lavori e interruzioni non sono mostrati: non esiste una fonte ufficiale in
            tempo reale collegata a questo progetto.
          </li>
          <li>
            Il percorso “più sicuro” è il più sicuro <em>secondo i dati disponibili</em>: resta
            una stima, non una garanzia.
          </li>
        </ul>
      </section>

      <ReportSection />
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
          calcolare e seguire il percorso e <strong>non viene mai memorizzata</strong>. Il
          calcolo avviene sul dispositivo: l’unica eccezione è il tratto a piedi che collega
          il tuo punto alla rete ciclabile, per il quale vengono inviate al servizio pedonale
          di OpenStreetMap le due sole coordinate di quel collegamento — nient’altro, e nulla
          che ti identifichi. Puoi negare il permesso: l’app resta utilizzabile scegliendo i
          punti sulla mappa.
        </p>

        <h2 className="panel-title" style={{ marginTop: 18 }}>Servizi esterni</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-700)' }}>
          Vengono richiesti a servizi esterni lo sfondo cartografico (CARTO/OpenFreeMap), la
          ricerca degli indirizzi (Nominatim/OpenStreetMap) e il solo tratto a piedi verso la
          rete ciclabile (Valhalla/OpenStreetMap). Come per qualunque richiesta web, quei
          servizi ricevono il tuo indirizzo IP, il testo che cerchi e — per il tratto a piedi —
          i due punti da collegare. Il percorso in bicicletta è calcolato interamente sul
          dispositivo: se quei servizi non sono raggiungibili la ricerca continua sui dati
          locali del progetto e il collegamento a piedi torna a essere indicato in linea d’aria.
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

function ReportSection(): JSX.Element | null {
  // Senza un canale configurato non c'e' niente da proporre: meglio non mostrare
  // la sezione che mostrarla e chiedere all'utente di rinunciare.
  if (!REPORT_ISSUE_URL) return null;

  return (
    <section className="panel-section">
      <h2 className="panel-title">Segnala un problema</h2>
      <p style={{ fontSize: 14, color: 'var(--ink-700)', marginBottom: 10 }}>
        Percorso interrotto, ostacolo non segnalato, fontanella non funzionante, dato errato: le
        segnalazioni aiutano a correggere i dati. Descrivi il problema e, se puoi, indica il
        punto sulla mappa; non servono dati personali.
      </p>
      <a
        className="btn btn--ghost btn--block btn--sm"
        href={REPORT_ISSUE_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Apri il modulo di segnalazione ↗
      </a>
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
