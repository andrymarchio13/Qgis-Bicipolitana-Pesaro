/**
 * Voce della navigazione.
 *
 * Le indicazioni vengono lette ad alta voce con la sintesi vocale del
 * dispositivo (Web Speech API): nessun audio viene scaricato, nessun testo
 * lascia il telefono, e non serve alcuna chiave di servizio. Le voci
 * disponibili sono quelle installate sul sistema — su Android sono quelle di
 * Google, su iOS e Windows quelle di Apple e Microsoft.
 *
 * La scelta preferisce una voce italiana maschile, come chiesto. Se sul
 * dispositivo non ce n'e' una, si usa la migliore voce italiana disponibile:
 * l'app non finge di avere qualcosa che non ha, e `chosenVoiceIsMale` permette
 * all'interfaccia di dirlo.
 */

/** Nomi di voci italiane maschili note su Android, iOS, Windows e macOS. */
const VOCI_MASCHILI = [
  'cosimo', // Microsoft, it-IT
  'diego', // Microsoft Natural, it-IT
  'giuseppe', // Microsoft Natural, it-IT
  'benigno',
  'calimero',
  'gianni',
  'luca', // Apple, it-IT
  'carlo',
  'marco',
  'giorgio',
  'paolo',
  'riccardo',
  'mattia',
  'lisandro',
];

/** Voci italiane femminili note: servono a non scambiarle per maschili. */
const VOCI_FEMMINILI = [
  'alice',
  'elsa',
  'isabella',
  'federica',
  'chiara',
  'giulia',
  'elisa',
  'palmira',
  'emma',
  'irina',
  'fiamma',
  'imelda',
];

/** Indizi di voci di qualita' superiore (neurali, migliorate, non compresse). */
const INDIZI_QUALITA = ['natural', 'neural', 'enhanced', 'premium', 'online', 'siri'];

const contains = (haystack: string, needles: string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

export interface VoiceChoice {
  voice: SpeechSynthesisVoice;
  /** true solo quando il nome corrisponde a una voce maschile riconosciuta. */
  male: boolean;
}

/**
 * Sceglie la voce da usare fra quelle installate.
 *
 * Esportata a parte dalla riproduzione perche' e' la parte che ha davvero una
 * regola da verificare: quale voce viene preferita, e cosa succede quando una
 * voce maschile non esiste.
 */
export function pickItalianVoice(voices: SpeechSynthesisVoice[]): VoiceChoice | null {
  const italiane = voices.filter((voice) => voice.lang?.toLowerCase().startsWith('it'));
  if (italiane.length === 0) return null;

  const score = (voice: SpeechSynthesisVoice): number => {
    const name = voice.name.toLowerCase();
    let points = 0;
    // Il genere pesa piu' di ogni altra cosa: e' la richiesta esplicita.
    if (contains(name, VOCI_MASCHILI)) points += 1000;
    if (contains(name, VOCI_FEMMINILI)) points -= 500;
    if (contains(name, INDIZI_QUALITA)) points += 50;
    if (voice.lang.toLowerCase() === 'it-it') points += 20;
    if (voice.default) points += 5;
    return points;
  };

  const best = italiane.reduce((a, b) => (score(b) > score(a) ? b : a));
  return { voice: best, male: contains(best.name.toLowerCase(), VOCI_MASCHILI) };
}

/**
 * Riscrive una distanza per essere pronunciata.
 *
 * `formatDistance` produce "350 m" e "1,2 km": abbreviazioni che le sintesi
 * vocali leggono in modo imprevedibile — "m" diventa spesso "metri" ma "km"
 * a volte diventa "kappa emme". Qui si scrive per esteso.
 */
export function spokenDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 20) return 'pochi metri';
  if (meters < 1000) {
    const rounded = Math.round(meters / 10) * 10;
    return `${rounded} metri`;
  }
  const km = meters / 1000;
  if (km < 10) {
    // La virgola decimale va detta: "1,2" letto come "1.2" diventa inglese.
    const [intero, decimale] = km.toFixed(1).split('.');
    return decimale === '0'
      ? `${intero} chilometri`
      : `${intero} virgola ${decimale} chilometri`;
  }
  return `${Math.round(km)} chilometri`;
}

/**
 * Ripulisce un testo destinato alla voce: via i simboli che verrebbero
 * pronunciati come parole, e le abbreviazioni scritte per l'occhio.
 */
export function speakableText(text: string): string {
  return text
    .replace(/[·•→←↑↓⇅]/g, ' ')
    // Le emoji non hanno una lettura sensata: alcune sintesi le ignorano,
    // altre ne dicono il nome in inglese in mezzo alla frase italiana.
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    // Il selettore di variante si toglie a parte: dentro la classe di sopra
    // formerebbe un carattere combinato, che e' un'altra cosa da cercare.
    .replace(/\u{FE0F}/gu, '')
    .replace(/\bkm\b/gi, 'chilometri')
    .replace(/(\d)\s*m\b/g, '$1 metri')
    .replace(/’/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Riproduzione
// ---------------------------------------------------------------------------

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Altoparlante della navigazione.
 *
 * Tiene la voce scelta e impedisce che due annunci si accavallino: in
 * navigazione un'indicazione vecchia che continua mentre ne arriva una nuova
 * e' peggio del silenzio.
 */
export class NavigationVoice {
  private choice: VoiceChoice | null = null;
  private ready = false;
  private onVoiceReady: (() => void) | null = null;

  constructor() {
    if (!isSpeechSupported()) return;
    this.loadVoices();
    /*
     * L'elenco delle voci arriva in modo asincrono e su alcuni browser e'
     * vuoto alla prima chiamata: senza questo ascolto la prima indicazione
     * verrebbe letta con la voce predefinita del sistema, spesso inglese.
     */
    window.speechSynthesis.addEventListener('voiceschanged', this.loadVoices);
  }

  private loadVoices = (): void => {
    if (!isSpeechSupported()) return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;
    this.choice = pickItalianVoice(voices);
    this.ready = true;
    this.onVoiceReady?.();
  };

  /** Nome della voce in uso, per mostrarlo nell'interfaccia. */
  get voiceName(): string | null {
    return this.choice?.voice.name ?? null;
  }

  /** true quando la voce scelta e' riconosciuta come maschile. */
  get isMale(): boolean {
    return this.choice?.male ?? false;
  }

  /** true quando il dispositivo ha almeno una voce italiana. */
  get hasItalianVoice(): boolean {
    return this.choice !== null;
  }

  /** Notifica l'interfaccia quando l'elenco delle voci diventa disponibile. */
  set onReady(handler: (() => void) | null) {
    this.onVoiceReady = handler;
    if (this.ready) handler?.();
  }

  /**
   * Legge un testo. `interrupt` tronca l'annuncio in corso: lo usano le
   * indicazioni imminenti, che non possono aspettare la fine di una frase
   * ormai superata.
   */
  speak(text: string, { interrupt = true }: { interrupt?: boolean } = {}): void {
    if (!isSpeechSupported()) return;
    const clean = speakableText(text);
    if (!clean) return;

    const synth = window.speechSynthesis;
    if (interrupt) synth.cancel();

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = this.choice?.voice.lang ?? 'it-IT';
    if (this.choice) utterance.voice = this.choice.voice;
    // Poco piu' svelto del parlato normale e leggermente piu' grave: e' il
    // registro che usano i navigatori, e resta comprensibile in bicicletta.
    utterance.rate = 1.05;
    utterance.pitch = 0.95;
    utterance.volume = 1;

    /*
     * Chrome sospende la sintesi quando la scheda perde il fuoco e non la
     * riprende da sola: senza questo, l'indicazione resta muta appena si
     * spegne e riaccende lo schermo.
     */
    if (synth.paused) synth.resume();
    synth.speak(utterance);
  }

  /** Zittisce subito: lo chiama l'uscita dalla navigazione e il pulsante muto. */
  cancel(): void {
    if (!isSpeechSupported()) return;
    window.speechSynthesis.cancel();
  }

  dispose(): void {
    if (!isSpeechSupported()) return;
    window.speechSynthesis.removeEventListener('voiceschanged', this.loadVoices);
    this.cancel();
  }
}
