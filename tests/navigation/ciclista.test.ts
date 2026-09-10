/**
 * Test del segno animato della posizione.
 *
 * Non si verifica che il disegno sia bello — non e' verificabile — ma le due
 * cose che possono rompere l'app: che da fermi l'animazione si spenga davvero,
 * e che senza canvas la mappa possa ripiegare sul pallino di prima invece di
 * fermarsi con un errore.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCyclistMarker } from '../../src/components/Map/cyclistMarker';

/** Canvas finto: registra le chiamate senza disegnare nulla davvero. */
function installCanvas({ withContext = true }: { withContext?: boolean } = {}): void {
  const context = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
  };

  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => (withContext ? context : null) }),
  });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ciclista animato', () => {
  it('non si costruisce senza un canvas, così la mappa può ripiegare sul pallino', () => {
    installCanvas({ withContext: false });
    expect(createCyclistMarker()).toBeNull();
  });

  it('non si costruisce fuori dal browser', () => {
    vi.stubGlobal('document', undefined);
    expect(createCyclistMarker()).toBeNull();
  });

  it('disegna il primo fotogramma anche da fermo', () => {
    installCanvas();
    const marker = createCyclistMarker();
    expect(marker).not.toBeNull();
    // Il primo `render` deve dichiarare l'immagine cambiata, altrimenti la
    // mappa mostrerebbe una trama vuota.
    expect(marker?.render()).toBe(true);
    expect(marker?.data.length).toBe(96 * 96 * 4);
  });

  it('da fermo smette di chiedere fotogrammi, per non consumare batteria', () => {
    installCanvas();
    const marker = createCyclistMarker();
    marker?.render();
    marker?.setSpeed(0);
    expect(marker?.render()).toBe(false);
  });

  it('riprende a disegnare quando la bicicletta riparte', () => {
    installCanvas();
    const marker = createCyclistMarker();
    marker?.render();
    marker?.setSpeed(4);
    expect(marker?.render()).toBe(true);
  });

  it('considera fermo il ciclista quando il GPS riporta una velocità irrisoria', () => {
    installCanvas();
    const marker = createCyclistMarker();
    marker?.render();
    // Il GPS non riporta mai zero esatto: 0,1 m/s è rumore, non pedalata.
    marker?.setSpeed(0.1);
    expect(marker?.render()).toBe(false);
  });

  it('tratta una velocità sconosciuta come fermo, senza pedalare a vuoto', () => {
    installCanvas();
    const marker = createCyclistMarker();
    marker?.render();
    marker?.setSpeed(null);
    expect(marker?.render()).toBe(false);
  });

  it('chiede alla mappa di ridisegnare finché si pedala', () => {
    installCanvas();
    const marker = createCyclistMarker();
    const triggerRepaint = vi.fn();
    marker?.onAdd({ triggerRepaint });
    marker?.setSpeed(5);
    marker?.render();
    expect(triggerRepaint).toHaveBeenCalled();
  });

  it('resta immobile per chi ha chiesto meno animazioni', () => {
    installCanvas();
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    const marker = createCyclistMarker();
    marker?.render();
    marker?.setSpeed(5);
    expect(marker?.render()).toBe(false);
  });
});
