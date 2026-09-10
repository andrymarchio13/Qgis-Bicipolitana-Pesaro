/**
 * Il segno della posizione durante la navigazione: un ciclista che pedala.
 *
 * Un cerchio dice dove sei ma non dice nulla di come ti stai muovendo. Qui il
 * segno e' un ciclista visto dall'alto, disegnato fotogramma per fotogramma su
 * un canvas e registrato come immagine animata di MapLibre: le gambe pedalano,
 * il corpo oscilla sui pedali e la cadenza segue la velocita' reale letta dal
 * GPS. Fermi, la pedalata si ferma.
 *
 * Vista dall'alto e non di profilo perche' l'icona ruota con la mappa: di
 * profilo sarebbe capovolta ogni volta che si va verso ovest, mentre dall'alto
 * resta corretta in qualsiasi orientamento e a mappa inclinata.
 *
 * Il disegno e' vettoriale e non un'immagine: pesa nulla da scaricare, resta
 * nitido su qualsiasi densita' di schermo e i colori restano quelli del tema.
 */

/** Lato dell'immagine in pixel di trama. */
const SIZE = 96;

/**
 * L'icona da 96 px viene mostrata a 32 px: nitida anche sugli schermi ad alta
 * densita', come gia' si fa per le emoji dei punti di interesse.
 */
export const CYCLIST_PIXEL_RATIO = 3;

export const CYCLIST_ICON_ID = 'user-cyclist';

/** Cadenza di pedalata da fermi e a regime, in pedalate al secondo. */
const CADENCE_IDLE_HZ = 0;
const CADENCE_MIN_HZ = 0.9;
const CADENCE_MAX_HZ = 1.6;

/** Velocita' (m/s) a cui la pedalata raggiunge la cadenza massima. ~22 km/h. */
const CADENCE_FULL_SPEED = 6;

/** Sotto questa velocita' si considera fermo: il GPS non e' mai esattamente 0. */
const STOPPED_SPEED = 0.4;

const VERDE = '#1ba26d';
const VERDE_SCURO = '#0f6b47';
const VERDE_CHIARO = '#34d399';
const SCURO = '#0b3d29';

/**
 * Immagine animata di MapLibre, ridichiarata qui invece di importare il tipo
 * della libreria: cosi' questo file non dipende dalla mappa e il disegno resta
 * verificabile da solo.
 */
export interface AnimatedStyleImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  render: () => boolean;
  onAdd: (map: { triggerRepaint: () => void }) => void;
  onRemove: () => void;
}

export interface CyclistMarker extends AnimatedStyleImage {
  /** Velocita' corrente in m/s: regola la cadenza della pedalata. */
  setSpeed: (metersPerSecond: number | null) => void;
}

/** Chi ha chiesto meno animazioni riceve un ciclista fermo, non un'icona diversa. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function roundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  const radius = Math.min(width, height) / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  // `roundRect` non esiste su tutti i browser che l'app dichiara di
  // supportare: il percorso si costruisce a mano.
  const left = x - width / 2;
  const top = y - height / 2;
  ctx.moveTo(left + radius, top);
  ctx.arcTo(left + width, top, left + width, top + height, radius);
  ctx.arcTo(left + width, top + height, left, top + height, radius);
  ctx.arcTo(left, top + height, left, top, radius);
  ctx.arcTo(left, top, left + width, top, radius);
  ctx.closePath();
  ctx.fill();
}

/**
 * Disegna un fotogramma.
 *
 * `phase` e' l'angolo della pedivella in radianti: da qui derivano la
 * posizione delle due gambe (opposte di mezzo giro) e l'oscillazione del
 * busto, che e' quello che rende la pedalata riconoscibile.
 */
function drawFrame(ctx: CanvasRenderingContext2D, phase: number, moving: boolean): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);

  // --- Cono di direzione: dice dove si sta andando, come sulle mappe note.
  const cone = ctx.createLinearGradient(0, 0, 0, -46);
  cone.addColorStop(0, 'rgba(27, 162, 109, 0.42)');
  cone.addColorStop(1, 'rgba(27, 162, 109, 0)');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 46, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42);
  ctx.closePath();
  ctx.fill();

  // --- Pastiglia bianca di fondo: stacca su qualsiasi cartografia.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1.5;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, 21, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Il velo verde lascia scoperto un anello bianco: e' quello che tiene il
  // segno leggibile anche sopra una macchia scura della cartografia.
  ctx.fillStyle = 'rgba(27, 162, 109, 0.16)';
  ctx.beginPath();
  ctx.arc(0, 0, 19, 0, Math.PI * 2);
  ctx.fill();

  // --- Bicicletta. Dall'alto si vedono le due ruote in fila e il manubrio.
  roundedBar(ctx, 0, 13, 3.4, 13, SCURO); // ruota posteriore
  roundedBar(ctx, 0, -12, 3.4, 13, SCURO); // ruota anteriore
  roundedBar(ctx, 0, 0, 2.6, 24, '#334155'); // telaio
  roundedBar(ctx, 0, -9, 20, 3, '#334155'); // manubrio

  /*
   * Il busto oscilla di poco e in fase con la pedalata: e' il dettaglio che
   * distingue un ciclista che pedala da un adesivo che scivola sulla mappa.
   */
  const sway = moving ? Math.sin(phase) : 0;
  ctx.save();
  ctx.rotate(sway * 0.05);
  ctx.translate(sway * 0.7, 0);

  /*
   * Gambe: mezzo giro di sfasamento fra destra e sinistra. Stanno larghe e
   * sporgono sotto il busto di proposito — a 32 pixel sullo schermo il
   * movimento si legge solo se avviene fuori dalla sagoma, e la pedalata e'
   * proprio quello che questo segno deve mostrare.
   */
  const legOffset = (angle: number): number => (moving ? Math.cos(angle) * 4.5 : 0);
  roundedBar(ctx, -6.2, 7 + legOffset(phase), 5, 15, VERDE_SCURO);
  roundedBar(ctx, 6.2, 7 + legOffset(phase + Math.PI), 5, 15, VERDE_SCURO);

  // Braccia: dalle spalle alle estremita' del manubrio.
  ctx.strokeStyle = VERDE_SCURO;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 4, -3);
    ctx.lineTo(side * 8.5, -8.5);
    ctx.stroke();
  }

  // Busto, piu' stretto delle gambe cosi' la pedalata resta scoperta.
  roundedBar(ctx, 0, 1, 11, 16, VERDE);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.beginPath();
  ctx.ellipse(0, -1.5, 3, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Casco. Una sola presa d'aria centrale: due, affiancate, a questa
  // dimensione si leggono come un paio d'occhi.
  ctx.fillStyle = VERDE_CHIARO;
  ctx.beginPath();
  ctx.arc(0, -6, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = SCURO;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  roundedBar(ctx, 0, -6.5, 1.8, 6, SCURO);

  ctx.restore();
  ctx.restore();
}

/**
 * Costruisce l'immagine animata. Restituisce `null` se il canvas non e'
 * disponibile: in quel caso la mappa continua a mostrare il pallino di prima.
 */
export function createCyclistMarker(): CyclistMarker | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const still = prefersReducedMotion();
  let map: { triggerRepaint: () => void } | null = null;
  let phase = 0;
  let cadenceHz = CADENCE_IDLE_HZ;
  let lastFrameAt = 0;
  /** Primo fotogramma sempre disegnato, anche ad animazioni disattivate. */
  let drawn = false;

  const marker: CyclistMarker = {
    width: SIZE,
    height: SIZE,
    data: new Uint8ClampedArray(SIZE * SIZE * 4),

    onAdd(instance) {
      map = instance;
    },

    onRemove() {
      map = null;
    },

    setSpeed(metersPerSecond) {
      if (metersPerSecond === null || metersPerSecond < STOPPED_SPEED) {
        cadenceHz = CADENCE_IDLE_HZ;
        return;
      }
      const ratio = Math.min(1, metersPerSecond / CADENCE_FULL_SPEED);
      cadenceHz = CADENCE_MIN_HZ + (CADENCE_MAX_HZ - CADENCE_MIN_HZ) * ratio;
    },

    render() {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = lastFrameAt === 0 ? 0 : (now - lastFrameAt) / 1000;
      lastFrameAt = now;

      const moving = !still && cadenceHz > 0;
      if (moving) phase += elapsed * cadenceHz * Math.PI * 2;

      /*
       * Da fermi non si ridisegna nulla e non si chiede un nuovo fotogramma:
       * l'animazione non deve tenere sveglia la mappa — e la batteria — mentre
       * si e' in attesa a un semaforo.
       */
      if (!moving && drawn) return false;

      drawFrame(ctx, phase, moving);
      marker.data = ctx.getImageData(0, 0, SIZE, SIZE).data;
      drawn = true;

      // Senza questa richiesta la mappa smette di disegnare appena si ferma
      // e l'animazione resta bloccata sul fotogramma raggiunto.
      if (moving) map?.triggerRepaint();
      return true;
    },
  };

  return marker;
}
