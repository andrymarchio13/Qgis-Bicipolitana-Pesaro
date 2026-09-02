/**
 * Rete di sicurezza dell'interfaccia.
 *
 * Un'eccezione durante il render lascerebbe altrimenti una pagina bianca: è il
 * caso peggiore per un'app installata, dove non c'è una console da consultare e
 * non è nemmeno evidente che si tratti di un errore e non di un caricamento
 * lento. Qui l'errore diventa una schermata leggibile, con il messaggio
 * tecnico consultabile e una via d'uscita.
 *
 * React non offre un equivalente a `componentDidCatch` per i componenti a
 * funzione: questo resta l'unico componente a classe del progetto.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { REPORT_ISSUE_URL } from '../../config';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Non esiste un backend a cui inviare la diagnostica: resta in console,
    // dove è recuperabile collegando il telefono in debug.
    console.error('Errore non gestito nell’interfaccia:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleReset = (): void => {
    // Lo stato salvato può essere esso stesso la causa: si torna alla home
    // pulita invece di ricadere subito nello stesso errore.
    window.location.hash = '#/';
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-screen" role="alert">
        <div className="error-screen__box">
          <span className="error-screen__icon" aria-hidden="true">
            ⚠️
          </span>
          <h1>Qualcosa è andato storto</h1>
          <p>
            L’applicazione ha incontrato un errore imprevisto e non può continuare da
            questa schermata. I dati del progetto non sono stati modificati.
          </p>

          <div className="error-screen__actions">
            <button type="button" className="btn btn--primary" onClick={this.handleReload}>
              Ricarica la pagina
            </button>
            <button type="button" className="btn btn--subtle" onClick={this.handleReset}>
              Torna alla mappa
            </button>
          </div>

          <details className="error-screen__details">
            <summary>Dettagli tecnici</summary>
            <p>
              Utili se vuoi segnalare il problema: indica cosa stavi facendo quando è
              comparsa questa schermata.
            </p>
            <pre>{error.message || error.name}</pre>
          </details>

          {REPORT_ISSUE_URL ? (
            <p className="error-screen__report">
              <a href={REPORT_ISSUE_URL} target="_blank" rel="noopener noreferrer">
                Segnala il problema
              </a>
            </p>
          ) : null}
        </div>
      </div>
    );
  }
}
