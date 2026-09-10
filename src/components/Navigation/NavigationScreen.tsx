/**
 * Schermata di navigazione a schermo intero.
 *
 * Mostra soltanto informazioni certe: manovra corrente, distanza residua e
 * tempo residuo stimato. Non annuncia svolte non deducibili dai dati.
 */
import { formatInstruction, maneuverIcon } from '../../services/routing/instructions';
import type { Line, Route, RouteInstruction } from '../../types';
import { formatDistance, formatDuration } from '../../utils/geo';
import type { UserPosition } from '../../hooks/useLocation';
import type { UseNavigationResult } from '../../hooks/useNavigation';
import { useVoiceGuidance } from '../../hooks/useVoiceGuidance';
import { MapView } from '../Map/MapView';
import { LineBadge, Notice } from '../UI';
import { WeatherBadge } from '../Weather/WeatherBadge';

export interface NavigationScreenProps {
  route: Route;
  navigation: UseNavigationResult;
  position: UserPosition | null;
  lines: Map<string, Line>;
  gpsMessage: string | null;
  onExit: () => void;
}

export function NavigationScreen({
  route,
  navigation,
  position,
  lines,
  gpsMessage,
  onExit,
}: NavigationScreenProps): JSX.Element {
  const instruction = navigation.nextInstruction ?? navigation.currentInstruction;
  const activeLineId = navigation.currentInstruction?.lineId ?? null;
  const activeLine = activeLineId ? lines.get(activeLineId) : undefined;
  const bannerColor = activeLine?.color ?? 'var(--brand-800)';

  const voice = useVoiceGuidance({
    route,
    instruction,
    distanceToManeuver: navigation.distanceToManeuver,
    remainingMeters: navigation.remainingMeters,
    arrived: navigation.arrived,
    offRoute: navigation.offRoute,
    rerouting: navigation.rerouting,
    active: navigation.active,
  });

  return (
    <div className="nav-screen">
      <div className="nav-screen__banner" style={{ background: bannerColor }}>
        <button
          type="button"
          onClick={onExit}
          aria-label="Torna indietro"
          style={{
            background: 'rgb(255 255 255 / 0.18)',
            border: 'none',
            color: '#fff',
            width: 40,
            height: 40,
            borderRadius: '50%',
            fontSize: 18,
          }}
        >
          ←
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          {navigation.arrived ? (
            <div className="nav-screen__instruction">Sei arrivato a destinazione</div>
          ) : (
            <>
              <div className="nav-screen__distance">
                {instruction && instruction.type !== 'arrive'
                  ? `Tra ${formatDistance(navigation.distanceToManeuver)}`
                  : `Ancora ${formatDistance(navigation.remainingMeters)}`}
              </div>
              <div className="nav-screen__instruction">
                {instruction ? instruction.text : 'Prosegui lungo il percorso'}
              </div>
            </>
          )}
        </div>

        {voice.supported ? (
          <button
            type="button"
            onClick={voice.toggle}
            aria-pressed={voice.enabled}
            aria-label={voice.enabled ? 'Disattiva la voce' : 'Attiva la voce'}
            title={
              voice.enabled
                ? voiceTitle(voice.voiceName, voice.isMale, voice.hasItalianVoice)
                : 'Le indicazioni non vengono lette ad alta voce'
            }
            style={{
              background: 'rgb(255 255 255 / 0.18)',
              border: 'none',
              color: '#fff',
              width: 40,
              height: 40,
              borderRadius: '50%',
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            {voice.enabled ? '🔊' : '🔇'}
          </button>
        ) : null}

        <div className="nav-screen__arrow" aria-hidden="true">
          {instruction ? maneuverIcon(instruction) : '↑'}
        </div>
      </div>

      {activeLineId ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <LineBadge id={activeLineId} line={activeLine} size="sm" />
          <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>
            Stai percorrendo la {activeLine?.officialName ? `Linea ${activeLineId} — ${activeLine.officialName}` : `Linea ${activeLineId}`}
          </span>
        </div>
      ) : null}

      <div className="nav-screen__map">
        <MapView
          route={route}
          userPosition={position}
          snappedPosition={navigation.snappedPosition}
          showOrigin={false}
          followUser
          bearing={navigation.courseDegrees ?? position?.heading ?? null}
          cyclist
          course={navigation.courseDegrees}
          speed={position?.speed ?? null}
          interactive
        />

        {(navigation.offRoute || navigation.rerouting || gpsMessage) && (
          <div style={{ position: 'absolute', left: 12, right: 12, top: 12, zIndex: 5 }}>
            {navigation.rerouting ? (
              <Notice variant="info" icon="🔄">
                Ricalcolo del percorso in corso…
              </Notice>
            ) : navigation.offRoute ? (
              <Notice variant="warning" icon="⚠️">
                Stai uscendo dal percorso ({formatDistance(navigation.offRouteMeters)} di scostamento).
                Il ricalcolo parte automaticamente se continui su questa strada.
              </Notice>
            ) : gpsMessage ? (
              <Notice variant="warning" icon="📡">
                {gpsMessage}
              </Notice>
            ) : null}
          </div>
        )}
        {/*
          Il meteo serve soprattutto qui: mentre si pedala si vuole sapere se
          sta arrivando la pioggia. Sta in basso a sinistra per non finire
          sotto gli avvisi di fuori-percorso, che occupano tutta la fascia
          alta.
        */}
        <WeatherBadge placement="nav" />
      </div>

      <div className="nav-screen__footer">
        <div className="nav-screen__stat">
          <b>{formatDistance(navigation.remainingMeters)}</b>
          <span>alla destinazione</span>
        </div>
        <div className="nav-screen__stat">
          <b>{formatDuration(navigation.remainingSeconds)}</b>
          <span>tempo residuo (stima)</span>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={onExit}>
          Termina
        </button>
      </div>
    </div>
  );
}

/**
 * Cosa dire del comando della voce.
 *
 * Se sul dispositivo non c'e' una voce italiana maschile non la si finge:
 * quali voci esistono dipende dal sistema, non dall'app, e chi si aspettava
 * un'altra voce merita di sapere perche' sente questa.
 */
function voiceTitle(name: string | null, male: boolean, italian: boolean): string {
  if (!italian) {
    return 'Nessuna voce italiana installata su questo dispositivo: le indicazioni vengono lette con la voce predefinita del sistema.';
  }
  if (!male) {
    return `Le indicazioni vengono lette da ${name}. Su questo dispositivo non è installata una voce italiana maschile: puoi aggiungerne una dalle impostazioni di sistema.`;
  }
  return `Le indicazioni vengono lette da ${name}.`;
}

/** I due tratti a piedi che raccordano il percorso alla rete coperta dai dati. */
const isWalkLeg = (instruction: RouteInstruction): boolean =>
  instruction.type === 'walk-start' || instruction.type === 'walk-end';

/** Elenco completo delle istruzioni, mostrato nel pannello dei risultati. */
export function InstructionList({ route, lines }: { route: Route; lines: Map<string, Line> }): JSX.Element {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {route.instructions.map((instruction) => (
        <li
          key={instruction.index}
          style={{
            display: 'flex',
            gap: 12,
            padding: '10px 0',
            borderBottom: '1px solid var(--border)',
            alignItems: 'flex-start',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontSize: 18,
              width: 26,
              textAlign: 'center',
              color: instruction.color ?? 'var(--ink-500)',
            }}
          >
            {maneuverIcon(instruction)}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14 }}>{formatInstruction(instruction)}</span>
            {instruction.lineId ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <LineBadge id={instruction.lineId} line={lines.get(instruction.lineId)} size="sm" />
              </span>
            ) : isWalkLeg(instruction) ? (
              /*
               * La qualifica sta qui, sul passo a cui si riferisce, invece che
               * in un avviso sul percorso: chi legge la vede nel momento in cui
               * le serve, e chi non ha tratti a piedi non la legge affatto.
               */
              <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-500)' }}>
                {route.walkingRouted
                  ? 'Collegamento fuori dai dati del progetto, calcolato su OpenStreetMap'
                  : 'Collegamento in linea d’aria, non un percorso calcolato'}
              </span>
            ) : instruction.streetName && !instruction.text.includes(instruction.streetName) ? (
              <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-500)' }}>
                {instruction.streetName}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
