/**
 * Tiene acceso lo schermo durante la navigazione.
 *
 * Un navigatore da bicicletta si guarda a colpi d'occhio, con le mani sul
 * manubrio: senza questo blocco il telefono si spegne dopo pochi secondi e
 * ogni svolta richiede di sbloccarlo. Il blocco vale solo mentre la
 * navigazione e' attiva, non per il resto dell'applicazione.
 *
 * Il sistema operativo revoca il blocco ogni volta che la pagina passa in
 * secondo piano — schermo spento a mano, cambio di scheda — e non lo
 * ripristina da solo: va richiesto di nuovo al ritorno, altrimenti la
 * navigazione riprende con lo schermo che si spegne.
 *
 * L'API non e' disponibile ovunque (Safari la supporta dalla 16.4). Dove
 * manca, la navigazione funziona esattamente come prima: il blocco e' un
 * miglioramento, non un requisito.
 */
import { useEffect, useState } from 'react';

export interface UseWakeLockResult {
  /** true se il browser espone l'API. */
  supported: boolean;
  /** true se il blocco e' attivo in questo momento. */
  active: boolean;
}

export function useWakeLock(enabled: boolean): UseWakeLockResult {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!supported || !enabled) return;

    let sentinel: WakeLockSentinel | null = null;
    // L'effetto puo' essere smontato mentre la richiesta e' in volo: senza
    // questa guardia il blocco appena ottenuto resterebbe acceso a
    // navigazione finita.
    let cancelled = false;

    const release = () => {
      const current = sentinel;
      sentinel = null;
      setActive(false);
      // Il rilascio fallisce se il blocco e' gia' stato revocato dal sistema:
      // e' il risultato voluto, non un errore da propagare.
      current?.release().catch(() => undefined);
    };

    const request = async () => {
      // Richiedere il blocco a pagina nascosta e' un errore certo: il momento
      // buono e' il ritorno in primo piano, gestito qui sotto.
      if (cancelled || sentinel !== null || document.visibilityState !== 'visible') return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
        setActive(true);
        // Il sistema puo' revocare il blocco per conto suo (batteria scarica):
        // lo stato deve dirlo, non restare fermo su "attivo".
        next.addEventListener('release', () => {
          if (sentinel === next) {
            sentinel = null;
            setActive(false);
          }
        });
      } catch {
        // Permesso negato o richiesta rifiutata: si prosegue senza blocco.
        setActive(false);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void request();
      else setActive(false);
    };

    void request();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      release();
    };
  }, [supported, enabled]);

  return { supported, active };
}
