/**
 * Guida vocale della navigazione.
 *
 * Collega lo stato della navigazione all'altoparlante: decide l'annuncio con
 * `announcementFor`, tiene l'elenco di quelli gia' letti e li pronuncia una
 * volta sola.
 *
 * La preferenza (voce accesa o spenta) resta sul dispositivo: e' una scelta
 * che vale per la prossima navigazione, non per la sessione corrente soltanto.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isSpeechSupported, NavigationVoice } from '../services/voice';
import { announcementFor } from '../services/voiceGuidance';
import type { Route, RouteInstruction } from '../types';

const STORAGE_KEY = 'bicipolitana:voce';

export interface UseVoiceGuidanceOptions {
  route: Route | null;
  instruction: RouteInstruction | null;
  distanceToManeuver: number;
  remainingMeters: number;
  arrived: boolean;
  offRoute: boolean;
  rerouting: boolean;
  /** true solo mentre la navigazione e' in corso. */
  active: boolean;
}

export interface UseVoiceGuidanceResult {
  /** false se il dispositivo non ha la sintesi vocale: il comando va nascosto. */
  supported: boolean;
  enabled: boolean;
  toggle: () => void;
  /** Nome della voce in uso, per spiegare quale si sta sentendo. */
  voiceName: string | null;
  /** false quando sul dispositivo non esiste una voce italiana maschile. */
  isMale: boolean;
  hasItalianVoice: boolean;
}

function readPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // In assenza di una scelta la voce e' accesa: e' la ragione per cui la si
    // e' chiesta, e zittirla e' un tocco.
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    // Modalita' privata o cookie bloccati: la preferenza vale per questa sola
    // navigazione, ma la voce funziona.
    return true;
  }
}

export function useVoiceGuidance({
  route,
  instruction,
  distanceToManeuver,
  remainingMeters,
  arrived,
  offRoute,
  rerouting,
  active,
}: UseVoiceGuidanceOptions): UseVoiceGuidanceResult {
  const supported = useMemo(() => isSpeechSupported(), []);
  const [enabled, setEnabled] = useState(readPreference);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [isMale, setIsMale] = useState(false);
  const [hasItalianVoice, setHasItalianVoice] = useState(false);

  const voice = useRef<NavigationVoice | null>(null);
  const spoken = useRef<Set<string>>(new Set());
  const started = useRef(false);

  // L'altoparlante vive quanto il componente: costruirlo a ogni render
  // riaggancerebbe l'ascolto dell'elenco delle voci a ogni punto GPS.
  useEffect(() => {
    if (!supported) return;
    const instance = new NavigationVoice();
    voice.current = instance;
    instance.onReady = () => {
      setVoiceName(instance.voiceName);
      setIsMale(instance.isMale);
      setHasItalianVoice(instance.hasItalianVoice);
    };
    return () => {
      instance.onReady = null;
      instance.dispose();
      voice.current = null;
    };
  }, [supported]);

  /*
   * Ogni percorso ha i suoi annunci. Dopo un ricalcolo le manovre sono altre,
   * e quelle gia' lette non devono zittire le nuove che hanno lo stesso
   * numero d'ordine.
   */
  useEffect(() => {
    spoken.current.clear();
    started.current = false;
  }, [route?.id]);

  // Uscendo dalla navigazione la voce tace subito, senza finire la frase.
  useEffect(() => {
    if (active) return;
    voice.current?.cancel();
    spoken.current.clear();
    started.current = false;
  }, [active]);

  useEffect(() => {
    if (!active || !enabled || !voice.current) return;

    const announcement = announcementFor({
      route,
      instruction,
      distanceToManeuver,
      remainingMeters,
      arrived,
      offRoute,
      rerouting,
      started: started.current,
    });
    if (!announcement || spoken.current.has(announcement.key)) return;

    spoken.current.add(announcement.key);
    if (announcement.kind === 'start') started.current = true;

    /*
     * Un annuncio ravvicinato tronca quello in anticipo: se «Tra 300 metri,
     * gira a destra» sta ancora parlando quando la svolta e' arrivata, la
     * frase utile e' la seconda. Gli altri aspettano il proprio turno.
     */
    voice.current.speak(announcement.text, {
      interrupt: announcement.kind === 'now' || announcement.kind === 'arrive',
    });
  }, [
    active,
    enabled,
    route,
    instruction,
    distanceToManeuver,
    remainingMeters,
    arrived,
    offRoute,
    rerouting,
  ]);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current;
      if (!next) voice.current?.cancel();
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
      } catch {
        // La preferenza non si e' potuta salvare: vale per questa navigazione.
      }
      return next;
    });
  }, []);

  return { supported, enabled, toggle, voiceName, isMale, hasItalianVoice };
}
