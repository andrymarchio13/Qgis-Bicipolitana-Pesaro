/**
 * Pagina di presentazione, mostrata prima di entrare nell'applicazione.
 *
 * Serve a dire in dieci secondi che cos'e' questo strumento, su quali dati si
 * regge e chi lo ha fatto: chi arriva da un link non lo sa, e una mappa che si
 * apre senza spiegazioni non lo dice.
 *
 * Nel frattempo il caricamento dei dati e' gia' partito: quando si preme
 * "Entra", l'applicazione e' quasi sempre gia' pronta. La presentazione non e'
 * un'attesa aggiunta, e' l'attesa che c'era gia', usata per dire qualcosa.
 *
 * Le animazioni raccontano l'oggetto invece di decorarlo: le linee sullo
 * sfondo si tracciano come si traccia un percorso, i numeri salgono fino al
 * valore che i dati dichiarano davvero. Tutte rispettano
 * `prefers-reduced-motion`, e senza di esse la pagina resta completa.
 */
import { useEffect, useRef, useState } from 'react';

import { useAppStore } from '../store/useAppStore';

export interface LandingPageProps {
  onEnter: () => void;
}

/** true se il sistema chiede di ridurre le animazioni. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = (): void => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * Conteggio animato fino al valore reale.
 *
 * Parte solo quando il dato e' arrivato: far salire un numero mentre non lo si
 * conosce ancora significherebbe mostrare cifre inventate, foss'anche per un
 * secondo.
 */
function useCountUp(value: number, enabled: boolean): number {
  const [shown, setShown] = useState(enabled ? 0 : value);
  const frame = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const duration = 900;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      // Decelerazione: il numero arriva a destinazione senza frenata brusca.
      setShown(value * (1 - (1 - t) ** 3));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, enabled]);

  return shown;
}

/**
 * Sfondo: linee che si tracciano e poi restano percorse.
 *
 * I colori sono quelli reali della simbologia del progetto: non e' un motivo
 * grafico qualsiasi, e' la stessa tavolozza che l'utente ritrovera' sulla
 * mappa. Ogni tracciato e' disegnato due volte — la linea, che compare una
 * volta sola e resta, e una luce che continua a scorrervi sopra, come chi la
 * sta percorrendo. Il movimento non finisce: una rete di trasporto ferma
 * sarebbe l'immagine sbagliata.
 */
function LineBackdrop({ colors }: { colors: string[] }): JSX.Element {
  const palette = colors.length > 0 ? colors : ['#15855a', '#2563eb', '#dc2626', '#f59e0b'];
  // Tracciati a 45°, come in una mappa metropolitana: nessuno rappresenta una
  // linea vera, e infatti restano sfumati sul fondo.
  const paths = [
    'M-100 220 L180 -60 L520 -60 L820 240 L1200 240',
    'M-100 420 L120 200 L470 200 L700 430 L1200 430',
    'M-100 620 L260 260 L640 260 L900 520 L1200 520',
    'M-100 760 L200 460 L560 460 L880 780 L1200 780',
    'M-100 120 L60 -40 L340 -40 L620 240 L1200 240',
  ];
  return (
    <svg
      className="landing__backdrop"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d, index) => (
        <g key={d} stroke={palette[index % palette.length]}>
          <path className="landing__trace" d={d} style={{ animationDelay: `${index * 0.45}s` }} />
          <path
            className="landing__spark"
            d={d}
            style={{
              // Velocita' leggermente diversa per ciascuna: sincronizzarle
              // renderebbe il movimento un effetto, non un andirivieni.
              animationDuration: `${7 + index * 1.6}s`,
              animationDelay: `${1.6 + index * 0.8}s`,
            }}
          />
        </g>
      ))}
    </svg>
  );
}

/** Numeri della rete: vengono dai dati caricati, non sono scritti a mano. */
function NetworkNumbers({ animate }: { animate: boolean }): JSX.Element {
  const data = useAppStore((s) => s.data);
  const ready = Boolean(data);

  const km = data ? data.lines.reduce((sum, line) => sum + line.lengthKm, 0) : 0;
  const lines = useCountUp(data?.lines.length ?? 0, animate && ready);
  const kmShown = useCountUp(km, animate && ready);
  const pois = useCountUp(data?.pois.length ?? 0, animate && ready);

  return (
    <dl className={`landing__numbers${ready ? ' is-ready' : ''}`}>
      <div>
        <dt>{ready ? Math.round(lines) : '—'}</dt>
        <dd>linee della rete</dd>
      </div>
      <div>
        <dt>{ready ? `${kmShown.toFixed(0)} km` : '—'}</dt>
        <dd>di percorsi ciclabili</dd>
      </div>
      <div>
        <dt>{ready ? Math.round(pois) : '—'}</dt>
        <dd>punti censiti</dd>
      </div>
    </dl>
  );
}

const FEATURES = [
  {
    icon: '🗺️',
    title: 'Percorsi calcolati, non disegnati',
    text: 'Un grafo topologico costruito dai dati GIS del progetto, con quattro criteri: Bicipolitana, più veloce, più tranquillo, più sicuro.',
  },
  {
    icon: '🧭',
    title: 'Navigazione passo-passo',
    text: 'Istruzioni di svolta, distanza e tempo residui, ricalcolo automatico quando ti allontani dal percorso.',
  },
  {
    icon: '🔒',
    title: 'Nessun account, nessun tracciamento',
    text: 'Il calcolo avviene nel tuo browser. La posizione GPS non viene memorizzata e non lascia il dispositivo.',
  },
  {
    icon: '📐',
    title: 'Dati dichiarati',
    text: 'Ciò che non è nei dati resta vuoto e i tempi sono presentati come stime. Le anomalie del dataset sono documentate, non nascoste.',
  },
];

export function LandingPage({ onEnter }: LandingPageProps): JSX.Element {
  const phase = useAppStore((s) => s.phase);
  const error = useAppStore((s) => s.error);
  const init = useAppStore((s) => s.init);
  const data = useAppStore((s) => s.data);
  const reducedMotion = usePrefersReducedMotion();

  const loading = phase === 'loading-data' || phase === 'loading-graph' || phase === 'idle';
  const lineColors = data?.lines.map((line) => line.color) ?? [];

  /* L'uscita e' un dissolvenza breve: l'app si monta subito dopo, e trattenerla
     piu' a lungo sarebbe tempo tolto a chi ha gia' deciso di entrare. */
  const [leaving, setLeaving] = useState(false);
  const enter = (): void => {
    if (reducedMotion) {
      onEnter();
      return;
    }
    setLeaving(true);
    window.setTimeout(onEnter, 320);
  };

  return (
    <main
      className={`landing${leaving ? ' is-leaving' : ''}${reducedMotion ? ' is-still' : ''}`}
    >
      <LineBackdrop colors={lineColors} />

      <div className="landing__inner">
        <p className="landing__eyebrow" style={{ '--step': 0 } as React.CSSProperties}>
          Università degli Studi di Urbino Carlo Bo · Geomatica
        </p>

        <h1 className="landing__title" style={{ '--step': 1 } as React.CSSProperties}>
          <span aria-hidden="true" className="landing__mark">
            🚲
          </span>
          <span>
            Bicipolitana
            <span className="landing__title-city">Pesaro</span>
          </span>
        </h1>

        <p className="landing__lead" style={{ '--step': 2 } as React.CSSProperties}>
          Il navigatore ciclabile della rete di Pesaro. Calcola percorsi reali sulle linee della
          Bicipolitana e sulla viabilità cittadina, propone alternative e ti accompagna con il
          GPS.
        </p>

        {/* Le linee vere, nei loro colori: la rete si presenta da sola. */}
        {lineColors.length > 0 ? (
          <div
            className="landing__strip"
            aria-hidden="true"
            style={{ '--step': 3 } as React.CSSProperties}
          >
            {data?.lines.map((line, index) => (
              <span
                key={line.id}
                style={{ background: line.color, animationDelay: `${0.5 + index * 0.045}s` }}
                title={`Linea ${line.id}`}
              />
            ))}
          </div>
        ) : null}

        <div style={{ '--step': 4 } as React.CSSProperties}>
          <NetworkNumbers animate={!reducedMotion} />
        </div>

        <ul className="landing__features">
          {FEATURES.map((feature, index) => (
            <li
              key={feature.title}
              style={{ '--step': 5 + index } as React.CSSProperties}
            >
              <span aria-hidden="true" className="landing__feature-icon">
                {feature.icon}
              </span>
              <span>
                <strong>{feature.title}</strong>
                {feature.text}
              </span>
            </li>
          ))}
        </ul>

        <div className="landing__actions" style={{ '--step': 9 } as React.CSSProperties}>
          {/*
            Il pulsante resta attivo anche mentre i dati arrivano: l'attesa e'
            di pochi secondi e l'applicazione la mostra a sua volta. Bloccare
            l'ingresso trasformerebbe la presentazione in una barriera.
          */}
          <button type="button" className="landing__enter" onClick={enter}>
            <span>Entra</span>
            <span aria-hidden="true" className="landing__enter-arrow">
              →
            </span>
          </button>

          <p className="landing__status" role="status" aria-live="polite">
            {phase === 'error' ? (
              <span className="landing__error">
                {error ?? 'Non è stato possibile caricare i dati del progetto.'}{' '}
                <button type="button" onClick={() => void init()}>
                  Riprova
                </button>
              </span>
            ) : loading ? (
              <>
                <span className="landing__pulse" aria-hidden="true" />
                Caricamento dei dati della Bicipolitana…
              </>
            ) : (
              <>
                <span className="landing__ready-dot" aria-hidden="true" />
                Dati caricati: l’applicazione è pronta.
              </>
            )}
          </p>
        </div>

        <footer className="landing__footer" style={{ '--step': 10 } as React.CSSProperties}>
          <p>
            Dati: progetto QGIS <strong>Pesaro2026</strong> — Comune di Pesaro, ©{' '}
            <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors,
            Regione Marche.
            {data ? (
              <>
                {' '}
                Ultimo aggiornamento: {new Date(data.metadata.generatedAt).toLocaleDateString('it-IT')}.
              </>
            ) : null}
          </p>
          <p>
            Progetto universitario a fini didattici: non è un servizio ufficiale del Comune di
            Pesaro.
          </p>
        </footer>
      </div>
    </main>
  );
}
