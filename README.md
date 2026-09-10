# Bicipolitana Pesaro — navigatore ciclabile

Applicazione web di navigazione ciclabile per la **Bicipolitana di Pesaro**, costruita
interamente sui dati del progetto GIS `Pesaro2026.qgz` realizzato in QGIS.

Non è una mappa statica: calcola percorsi reali su un grafo topologico derivato dalle
linee della Bicipolitana e dalla rete stradale OpenStreetMap di Pesaro, propone
alternative, segue la posizione GPS e ricalcola il percorso quando ci si allontana.

---

## Indice

1. [Cosa fa](#1-cosa-fa)
2. [Regola fondamentale sui dati](#2-regola-fondamentale-sui-dati)
3. [Architettura](#3-architettura)
4. [I dati GIS di partenza](#4-i-dati-gis-di-partenza)
5. [Sistemi di riferimento](#5-sistemi-di-riferimento)
6. [Pipeline di conversione](#6-pipeline-di-conversione)
7. [Il grafo di routing](#7-il-grafo-di-routing)
8. [Il motore di calcolo](#8-il-motore-di-calcolo)
9. [Scelte tecniche del frontend](#9-scelte-tecniche-del-frontend)
10. [Installazione](#10-installazione)
11. [Sviluppo](#11-sviluppo)
12. [Build e deploy](#12-build-e-deploy)
13. [Aggiornare i dati GIS](#13-aggiornare-i-dati-gis)
14. [Variabili d’ambiente](#14-variabili-dambiente)
15. [Test](#15-test)
16. [Limiti attuali](#16-limiti-attuali)
17. [Sviluppi futuri](#17-sviluppi-futuri)
18. [Licenze e attribuzioni](#18-licenze-e-attribuzioni)

---

## 1. Cosa fa

- Mostra le **15 linee** della Bicipolitana (1–13, A, B) con i colori della simbologia QGIS.
- Cerca origine e destinazione per indirizzo, POI, nome di linea, GPS o punto sulla mappa.
- Calcola percorsi con **quattro profili**: Bicipolitana, Più veloce, Più tranquillo, Più sicuro.
- **Propone fino a cinque percorsi diversi** per lo stesso viaggio, non solo uno per profilo:
  le alternative restano disegnate tratteggiate sulla mappa, con il tempo stimato scritto
  sopra, e si scelgono toccandole.
- Mostra distanza, tempo stimato, linee utilizzate, percentuale di percorso su Bicipolitana.
- **Mette in risalto il percorso scelto**: alone luminoso pulsante, tratteggio che scorre nel
  verso di marcia e attenuazione del resto della rete, così il tracciato non si confonde con
  le linee su cui corre.
- **Simboli leggibili sulla mappa**: i punti di interesse usano emoji renderizzate come icone
  (MapLibre non disegna emoji dai font di glifi); toccando un gruppo numerato la mappa si apre
  esattamente allo zoom che lo scioglie, e se i punti sono sovrapposti ne mostra l'elenco.
- **Dichiara i tratti da fare a piedi**: quando origine o destinazione cadono fuori dalla
  rete coperta dai dati, il punto non viene rifiutato — il collegamento fino alla rete
  viene disegnato tratteggiato, conteggiato nel totale e annunciato nelle istruzioni.
  Quel solo tratto viene ricalcolato sulla rete pedonale OSM (`VITE_WALK_ROUTING_URL`),
  così segue le strade invece di attraversare i campi; se il servizio non risponde resta
  il segmento in linea d'aria calcolato offline, dichiarato come tale.
- Genera **istruzioni passo-passo** e segnala i cambi di linea.
- **Salva e riapre un itinerario**: scelto un percorso fra le alternative, «Salva itinerario»
  lo scrive in un file `.bicipesaro.json` con geometria, tappe, indicazioni e avvisi;
  «Apri itinerario salvato», nella schermata iniziale, lo ripristina identico senza
  ricalcolarlo, dichiarando la data di salvataggio. Accanto c'è l'esportazione **GPX** per
  ciclocomputer e altre app (sola andata: il GPX non conserva indicazioni e linee percorse).
- Naviga con GPS, distanza e tempo residui, avviso di fuori-percorso e **ricalcolo automatico**.
- **Ti mostra come un ciclista che pedala**, non come un pallino: il segno della posizione e'
  un'icona disegnata su canvas e animata fotogramma per fotogramma, orientata secondo la
  direzione del tratto che stai percorrendo. La cadenza della pedalata segue la velocita'
  letta dal GPS e da fermo si ferma — anche per non tenere sveglia la mappa a un semaforo.
  Chi ha chiesto meno animazioni al sistema riceve la stessa icona, immobile.
- **Legge le indicazioni ad alta voce**, come un navigatore: ogni manovra viene annunciata
  due volte, in anticipo (300 m) e al momento di farla (60 m), piu' partenza, arrivo,
  fuori-percorso e ricalcolo. Usa la sintesi vocale del dispositivo, preferendo una voce
  **italiana maschile** fra quelle installate; se non ce n'e' una, usa la migliore voce
  italiana disponibile e lo dichiara invece di fingere. Si zittisce con un tocco e la scelta
  resta memorizzata. Nessun audio scaricato, nessuna chiave, nessun testo fuori dal telefono.
- Mostra servizi, ostacoli e punti di svago con tutti gli attributi del GeoPackage.
- È installabile come **PWA** e funziona parzialmente offline.
- Si pubblica su **GitHub Pages** senza backend e senza chiavi API.

## 2. Regola fondamentale sui dati

Il progetto vale quanto i dati che lo sostengono, quindi:

- **nessun dato è inventato.** Linee, coordinate, servizi e ostacoli provengono dai
  GeoPackage originali;
- ciò che non esiste nel dataset resta vuoto e viene mostrato come
  *“Informazione non disponibile”* — mai come stringa inventata;
- i **nomi ufficiali** delle linee non sono nel dataset: il campo `officialName` è `null`
  e va compilato in `data/lines.json` solo a partire da una fonte verificabile;
- lo **stato** delle linee (attiva/chiusa) non esiste nel dataset: è `unknown`;
- tempi, punteggi di sicurezza e fattori di superficie sono **stime euristiche
  dichiarate**, non misure di campo, e sono tutte concentrate in file di configurazione;
- non vengono mostrate chiusure o lavori in corso: manca una fonte ufficiale in tempo
  reale. La struttura per farlo (`data/incidents.json`) è predisposta e mostra un
  incidente solo se dichiara una `source`;
- l’app non dichiara mai un percorso “sicuro”, ma *“più sicuro secondo i dati disponibili”*.

Le anomalie trovate nei dati non sono state nascoste: sono elencate in
[`docs/data_audit_report.md`](docs/data_audit_report.md) e mostrate nell’interfaccia.

## 3. Architettura

```
                 QGIS (Pesaro2026.qgz + GeoPackage, EPSG:3004)
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │        pipeline Python (eseguita offline)           │
        │                                                     │
        │  validate-gis.py  →  docs/data_audit_report.md      │
        │  convert-gpkg.py  →  data/geojson/, lines.json      │
        │  build-routing-graph.py → data/routing/graph.json   │
        │  generate-metadata.py   → public/data/              │
        └──────────────────────────┬──────────────────────────┘
                                   │  file statici
                    ┌──────────────┴───────────────┐
                    │   Frontend React + TypeScript │
                    │                               │
                    │   MapLibre GL JS  ← mappa     │
                    │   A* su grafo locale ← routing│
                    │   Geocoder composito ← ricerca│
                    │   Service worker  ← PWA       │
                    └───────────────────────────────┘
```

Il calcolo dei percorsi avviene **nel browser**, sul grafo generato dai dati GIS.
Non serve un server, non servono chiavi API, e l’app continua a calcolare percorsi
anche senza rete una volta caricati i dati.

### Struttura del repository

```
scripts/                 pipeline GIS (Python)
  gis_config.py          parametri condivisi: CRS, tolleranze, stime
  validate-gis.py        FASE 1 — analisi e validazione
  convert-gpkg.py        FASE 2 — conversione in GeoJSON + lines.json
  build-routing-graph.py FASE 3 — costruzione del grafo
  generate-metadata.py   FASE 4 — manifesto e pubblicazione

data/
  raw/                   copia intatta dei GeoPackage e del progetto QGIS
  geojson/               dati convertiti in WGS84
  processed/             rete stradale completa (solo per il grafo)
  routing/               graph.json, topology_report.json
  metadata/              validation.json, conversion.json, manifest.json
  lines.json             anagrafica delle linee
  metadata.json          metadati del progetto

public/data/             i soli file scaricati dal browser
src/
  components/            Map, Search, Routing, Lines, Navigation, UI
  pages/                 Home, Linee, Dettaglio linea, Servizi, Info, Privacy
  services/              routing/, geocoding/, data.ts, itinerary.ts,
                         voice.ts, voiceGuidance.ts
  hooks/                 useLocation, useNavigation, useGeocoding, useWakeLock,
                         useVoiceGuidance
  store/                 stato globale (Zustand)
  types/                 tipi condivisi
  config/                parametri e profili di calcolo
  utils/                 geometria e formattazione
tests/                   data/, routing/, utils/, geocoding/, navigation/
```

## 4. I dati GIS di partenza

| Layer | Feature | Geometria | Contenuto |
|---|---|---|---|
| `linee_bicipolitana` | 18 | MultiLineString | le 15 linee, campo `Nome_Linea` |
| `servizi_bicipolitana` | 35 | Point | fontanelle, parcheggi, noleggi, officine |
| `ostacoli_bicipolitana` | 31 | Point | barriere ciclabili (tag OSM) |
| `punti_svago` | 12 | Point | parchi, belvedere, area picnic |
| `strade` | 5.208 | LineString | rete stradale OSM di Pesaro, 679 km |

Estensione: 12,83–13,00 E · 43,84–43,94 N. Lunghezza totale Bicipolitana: **61,06 km**.

### Anomalie realmente presenti nei dati

Rilevate automaticamente dalla FASE 1 e **non corrette d’ufficio**:

| Anomalia | Trattamento |
|---|---|
| Feature 3 (linea 3) ha geometria vuota | esclusa dal routing, dichiarata nei metadati |
| La linea 13 non ha categoria nella simbologia QGIS | colore di ripiego, marcato `colorNeedsConfirmation` |
| Le linee 2 e 5 condividono il colore `#1f78b4` | conservato com’è, segnalato in `colorConflictsWith` |
| Le linee 5 e 7 sono spezzate in 2 tronconi (distanza 0,0 m) | ricongiunte dal `linemerge` |
| 31 coppie di linee si toccano per attraversamento | nodalizzate nel grafo |

## 5. Sistemi di riferimento

- **EPSG:3004** (Monte Mario / Italy zone 2) — CRS del progetto QGIS. Usato per tutte le
  misure metriche: lunghezze, tolleranze, distanze, snapping.
- **EPSG:4326** (WGS84) — usato per il web, perché la cartografia in rete e l’API di
  geolocalizzazione del browser lavorano in longitudine/latitudine.

I file originali **non vengono mai riproiettati sul posto**: la conversione produce nuovi
file, mentre `data/raw/` resta identico al progetto QGIS.

Nota: il layer `bicipolitanaquery` presente nel GeoPackage dei servizi è una copia in
EPSG:4326 dello stesso contenuto; la pipeline usa il layer `servizi_bicipolitana` in
EPSG:3004, coerente con il resto del progetto.

## 6. Pipeline di conversione

```bash
npm run data
```

equivale a:

```bash
python scripts/validate-gis.py         # FASE 1 — analisi e audit
python scripts/convert-gpkg.py         # FASE 2 — GeoJSON, lines.json, metadata.json
python scripts/build-routing-graph.py  # FASE 3 — grafo e report topologico
python scripts/generate-metadata.py    # FASE 4 — manifesto e pubblicazione
```

La FASE 1 termina con esito negativo se trova problemi bloccanti: in quel caso **il grafo
non va costruito** finché i dati non sono corretti in QGIS.

Dipendenze Python: `geopandas`, `shapely`, `pyproj`, `pyogrio` (installabili con
`pip install geopandas shapely pyproj pyogrio`).

## 7. Il grafo di routing

Costruito da `build-routing-graph.py` unendo Bicipolitana e rete stradale in un unico
grafo planarizzato:

1. le `MultiLineString` vengono esplose in `LineString`;
2. si calcolano **tutte le intersezioni reali** fra archi (bici↔bici, bici↔strada,
   strada↔strada);
3. si rilevano i **near miss** — archi vicini ma non intersecanti;
4. ogni arco viene tagliato nei punti di intersezione;
5. i nodi coincidenti vengono fusi;
6. a ogni arco si associano lunghezza, tempo stimato, tag ciclabili, ostacoli entro il
   raggio di influenza e punteggio di sicurezza;
7. si analizzano le componenti connesse e si potano gli archi irraggiungibili.

### Tolleranze differenziate, e perché

| Parametro | Valore | Motivazione |
|---|---|---|
| `TOPOLOGY_SNAP_TOLERANCE_METERS` | 5,0 m | la Bicipolitana è digitalizzata su CTR/ortofoto e non condivide i nodi con OSM: per agganciarla serve tolleranza |
| `NEAR_MISS_TOLERANCE_ROAD_ROAD_M` | 0,5 m | le strade vengono da un solo estratto OSM: agli incroci reali condividono già il nodo. Due strade vicine ma separate lo sono davvero (muro, argine, sottopasso): collegarle a 5 m creerebbe **scorciatoie inesistenti** |
| `OBSTACLE_INFLUENCE_RADIUS_M` | 12,0 m | distanza entro cui un ostacolo puntuale è considerato sull’arco |
| `SIMPLIFY_TOLERANCE_METERS` | 1,0 m | semplificazione Douglas-Peucker, sotto la precisione della digitalizzazione |
| `MIN_EDGE_LENGTH_M` | 0,30 m | sotto questa soglia due nodi sono lo stesso punto e vengono fusi |

### Risultato

| | |
|---|---|
| Nodi | 9.335 |
| Archi | 12.674 (di cui 1.906 di Bicipolitana) |
| Componenti connesse | **1** |
| Bicipolitana raggiungibile | **100%** (61,05 km) |
| `graph.json` | 2,2 MB → **~457 KB** serviti compressi |

Diagnostica completa in [`data/routing/topology_report.json`](data/routing/topology_report.json).

## 8. Il motore di calcolo

**A\*** con euristica ammissibile (distanza in linea d’aria divisa per la velocità massima
teorica del profilo): garantisce il percorso ottimo esplorando meno nodi di Dijkstra.

Costo di un arco:

```
costo = tempo_stimato
      × fattore_tipo            (Bicipolitana favorita o penalizzata)
      × (1 + peso_sicurezza × (1 − safetyScore))
      + penalità_ostacoli
      + penalità_cambio_linea
```

I profili si distinguono solo per questi coefficienti, tutti in `src/config/index.ts`:

| Profilo | Fattore Bicipolitana | Fattore strada | Peso sicurezza | Ostacolo | Cambio linea |
|---|---|---|---|---|---|
| 🚲 Bicipolitana | 0,45 | 1,35 | 0,6 | 20 s | 30 s |
| ⚡ Più veloce | 0,95 | 1,00 | 0,15 | 15 s | 0 s |
| 🌿 Più tranquillo | 0,60 | 1,15 | 1,6 | 45 s | 15 s |
| 🛡️ Più sicuro | 0,50 | 1,25 | 2,4 | 70 s | 20 s |

Il profilo Bicipolitana **non sceglie sempre la Bicipolitana**: se la destinazione è
lontana dalla rete ufficiale, il costo di un lungo aggiramento supera quello del
collegamento diretto, e il percorso risulta origine → collegamento ciclabile →
Bicipolitana → uscita → destinazione.

### Perché i profili non bastano a fare delle alternative

I quattro profili guardano lo stesso grafo con pesi diversi, ma dove esiste un corridoio
evidente — e Pesaro, lunga e stretta fra il mare e la Foglia, ne ha parecchi — ci
finiscono tutti. Il risultato era che i doppioni venivano scartati e all’utente restava
**un percorso solo**: nessuna scelta, su una mappa costruita apposta per mostrarla.

Dopo il giro sui profili il router ne fa altri, rendendo più cari gli archi già proposti
invece di vietarli: dove la strada è una sola deve poter restare quella. La penalità
cresce a gradini (`ROUTE_ALTERNATIVE_PENALTIES`, 1,8 → 3,2 → 6) perché una penalità
leggera ritrova quasi lo stesso percorso e una pesante manda subito troppo lontano; ci si
ferma appena si raggiunge `VITE_MAX_ROUTE_ALTERNATIVES` (5).

Le due soglie di somiglianza rispondono a due domande diverse. Fra profili si scartano
solo i doppioni veri (`VITE_ROUTE_DUPLICATE_THRESHOLD`, 0,9): «più veloce» e
«Bicipolitana» possono quasi coincidere e restano comunque due risposte oneste a due
domande diverse. Per le alternative la soglia è severa (`VITE_ROUTE_SIMILARITY_THRESHOLD`,
0,7): nascono per aggiungere una strada diversa, e se non lo fanno non hanno motivo di
comparire. La somiglianza si misura nei due versi e si tiene la più alta, altrimenti un
percorso corto contenuto in uno lungo passerebbe per alternativa.

Queste alternative **non portano l’etichetta di un profilo**: si chiamano «Alternativa 1»,
«Alternativa 2», perché non seguono un criterio diverso — seguono lo stesso, su strade
diverse — e dirlo altrimenti sarebbe dichiarare un criterio che non c’è.

Sulla mappa sono disegnate tratteggiate dietro al percorso scelto, con il tempo stimato
scritto sopra, e si scelgono toccandole. Prima erano grigie al 35% di opacità, cioè
invisibili sullo sfondo della mappa: erano già calcolate, ma non si vedevano.

Il `safetyScore` (0–1) è calcolato in fase di build da regole esplicite: classe della
strada, `bicycle=designated`, presenza di corsia ciclabile, illuminazione, limite di
velocità, ostacoli. È un’euristica dichiarata, non un rilievo.

**La pendenza non è considerata**: il progetto GIS non contiene un modello digitale del
terreno, e stimarla sarebbe inventare un dato.

### Dove il percorso si innesta sulla rete

Il grafo ha nodi solo agli incroci, ma chi chiede un percorso si trova quasi sempre a metà
strada fra due incroci. Far raggiungere a piedi l’incrocio successivo significa centinaia
di metri di cammino lungo una strada che si ha di fianco — in campagna, dove un arco può
essere lungo chilometri, molto di più.

Per ogni richiesta il grafo viene quindi **ampliato**: nei punti in cui origine e
destinazione incontrano la rete si aggiungono nodi che spezzano l’arco, e un nodo terminale
collegato ai vari innesti candidati da archi a piedi. È il calcolo del percorso a scegliere
dove conviene entrare in rete, perché è l’unico che vede insieme il cammino e la pedalata
che ne segue: così un innesto qualche metro più lontano ma sulla Bicipolitana può battere
uno più vicino ma su una statale. L’indice caricato dal file non viene mai modificato.

**Non tutti i metri a piedi sono uguali.** Raggiungere una strada a scorrimento significa
camminare sul ciglio di una carreggiata veloce — e poi immettersi in bicicletta proprio lì;
arrivare a una ciclabile o a una via residenziale no. Il costo del collegamento è quindi
moltiplicato per l'esposizione dell'arco su cui ci si innesta, `1 + VITE_WALK_SAFETY_WEIGHT
× (1 − safety)`: un innesto un po' più lontano ma su una via tranquilla può battere quello
davanti a casa sulla statale. Il punteggio di sicurezza è quello euristico del grafo,
dichiarato come tutti gli altri.

Tre vincoli tengono onesto il meccanismo: gli innesti candidati devono stare entro
`ATTACH_TOLERANCE_METERS` (150 m) dal più vicino, oltre non vengono nemmeno considerati; un
minuto a piedi costa `VITE_WALK_COST_FACTOR` (2,2) volte un minuto pedalato, perché
spingere la bici è peggio che pedalare anche a parità di minuti; e la distanza dichiarata
resta sempre quella vera, perché l'esposizione pesa sulla *scelta*, non sui numeri mostrati.

### Punti fuori dalla rete coperta dai dati

Il grafo copre l’area del progetto. Un punto scelto fuori da quell’area **non viene
rifiutato**: si cerca la rete entro `VITE_WALK_SNAP_MAX_DISTANCE_METERS` (40 km, cioè tutta
la provincia) e il tratto scoperto entra nel percorso come collegamento dichiarato —
tratteggiato sulla mappa, conteggiato in distanza e tempo, annunciato nelle istruzioni.
Il limite resta solo per non pretendere di collegare alla Bicipolitana un punto che con
Pesaro non ha niente a che vedere.

**Il raccordo non è sempre a piedi.** Sotto `VITE_CONNECTOR_RIDE_THRESHOLD_METERS` (500 m)
si spinge la bicicletta — attraversare, uscire da un cortile — e il tratto viene calcolato
sulla rete pedonale. Sopra, si pedala: il tempo usa la velocità in bicicletta, l’istruzione
dice «raggiungi in bicicletta», l’icona è una bici e il tratto viene calcolato con il
profilo ciclabile più prudente che il servizio espone. Proporre un’ora di cammino a chi
chiede un percorso ciclabile, solo perché i dati del progetto finiscono prima di casa sua,
non sarebbe una risposta.

Il **percorso in bicicletta** non ha alcun servizio esterno di riserva, ed è una scelta:
farlo dipendere da una chiave API e da una rete disponibile smentirebbe proprio la
funzione che il progetto rivendica come offline. Fuori dagli 8 km l’app dichiara che il
punto è fuori area, invece di inventare un percorso su dati che non ha.

Il **collegamento a piedi**, invece, viene rifinito su rete pedonale OSM
(`VITE_WALK_ROUTING_URL`, per impostazione predefinita il Valhalla pubblico di
OpenStreetMap): senza una rete pedonale nei dati del progetto quel tratto resterebbe una
linea d'aria che attraversa campi ed edifici, cioè un percorso che nessuno può fare.
Il servizio viene interrogato con un profilo pedonale tarato: percorsi pedonali e
marciapiedi resi più convenienti, vicoli e passi carrai scoraggiati, scale e sentieri
impegnativi penalizzati — con una bicicletta a mano non sono un'alternativa. E se il
percorso che torna supera di `VITE_WALK_ROUTING_MAX_DETOUR` volte la linea d'aria, fra i
due punti c'è una barriera (un'autostrada, una ferrovia): la risposta è corretta ma
inutilizzabile, e si tiene la linea d'aria dichiarata come tale invece di mostrare un giro
di chilometri.

La chiamata riguarda solo quel tratto, invia soltanto le sue due coordinate, non richiede
chiavi e non blocca la comparsa del risultato: il percorso appare subito con il tratto
calcolato offline e viene ridisegnato quando la risposta arriva. Se il servizio non
risponde — o se si svuota `VITE_WALK_ROUTING_URL` — l'app torna al comportamento
interamente offline, con il collegamento in linea d'aria dichiarato come tale.

## 9. Scelte tecniche del frontend

**React + TypeScript + Vite**: tipizzazione stretta su strutture geometriche complesse,
build veloce, output statico adatto a GitHub Pages.

**MapLibre GL JS invece di Leaflet**, per tre motivi concreti:

1. rende su GPU migliaia di geometrie (13.000 archi, POI, percorso) senza degrado, dove
   Leaflet crea un nodo DOM per elemento;
2. espone rotazione e inclinazione della camera, indispensabili per la modalità
   navigazione orientata secondo la direzione di marcia;
3. è una libreria libera, senza vincoli di provider: il basemap è configurabile e
   l’applicazione non dipende da servizi proprietari.

Il basemap predefinito è **CARTO Positron**, lo stesso usato nel progetto QGIS originale,
per continuità visiva. L’attribuzione è sempre visibile e non rimovibile dall’interfaccia.

**Zustand** per lo stato globale: sufficiente per questa scala e senza boilerplate.

**HashRouter**: GitHub Pages serve solo file statici e non riscrive le rotte lato server;
con l’hash ogni URL profondo (`/#/linea/3`) resta valido anche ricaricando la pagina.

**Un error boundary alla radice** ([`src/components/UI/ErrorBoundary.tsx`](src/components/UI/ErrorBoundary.tsx)):
senza, un'eccezione in fase di render lascerebbe una pagina bianca — il caso peggiore per
un'app installata, dove non c'è una console da consultare e l'utente non distingue un
errore da un caricamento lento. È l'unico componente a classe del progetto, perché React
non espone `componentDidCatch` ai componenti a funzione.

## 10. Installazione

Requisiti: **Node.js ≥ 18**, **Python ≥ 3.10** (solo per rigenerare i dati).

```bash
git clone <url-del-repository>
cd bicipolitana-pesaro
npm install
cp .env.example .env      # facoltativo: i default funzionano già
```

I dati sono già generati in `public/data/`, quindi l’app parte subito.

## 11. Sviluppo

```bash
npm run dev        # server di sviluppo su http://localhost:5173
npm run dev:lan    # come sopra, raggiungibile dagli altri dispositivi della rete
npm run dev:mobile # come dev:lan ma in HTTPS: serve per provare il GPS dal telefono
npm run cert       # una tantum: genera i certificati usati da dev:mobile
npm run cert:trust # una tantum: installa la CA locale su questo computer
npm run lint      # controllo statico
npm test          # suite di test
npm run build     # build di produzione in dist/
npm run preview   # anteprima della build
```

### Aprire l'app dal telefono

`npm run dev:lan` stampa anche l'indirizzo di rete (`http://192.168.x.x:5173/`): basta
digitarlo nel browser del telefono, collegato alla stessa Wi-Fi. Il computer deve restare
acceso con il comando in esecuzione.

### Provare il GPS dal telefono: serve HTTPS

I browser espongono la posizione solo alle **origini sicure**: `https://` oppure
`localhost`. L'indirizzo di rete (`http://192.168.x.x:5173`) non è né l'uno né l'altro,
quindi con `npm run dev` o `npm run dev:lan` il telefono **nega la posizione a
prescindere dall'applicazione**.

Per questo esiste `npm run dev:mobile`, che è l'unico comando ad attivare il TLS: lo
sviluppo normale resta in HTTP, senza certificati fra i piedi, e il certificato si usa
solo quando serve davvero.

```bash
npm run cert         # una tantum: crea certs/rootCA.crt e certs/dev.crt
npm run cert:trust   # una tantum, su questo computer
npm run dev:mobile   # https://192.168.x.x:5173
```

`npm run cert` genera una **CA locale** e il certificato del server firmato da essa,
valido per `localhost` e per gli IP di rete della macchina al momento della generazione.
Serve una CA e non un certificato self-signed perché i browser basati su Chromium
rifiutano un certificato foglia (`ERR_CERT_AUTHORITY_INVALID`) anche se importato fra le
radici: deve esistere un emittente separato di cui fidarsi.

Sul telefono la CA non è installata, quindi comparirà l'avviso sul certificato. Accettarlo
una volta (*Avanzate → Procedi*) basta per vedere l'app, **ma non sempre per la
posizione**: su una pagina con un errore di certificato i browser possono continuare a
negare le funzioni sensibili. Per una prova affidabile si installa `certs/rootCA.crt`
anche sul dispositivo (Android: *Impostazioni → Sicurezza → Credenziali → Installa un
certificato → Certificato CA*; iOS: si installa il profilo e poi si abilita la fiducia
completa in *Generali → Info → Attendibilità certificati*).

Se cambia l'IP locale (rete diversa), rigenera con `npm run cert -- --force`; rigenerando
si crea anche una CA nuova, quindi va reinstallata.

La cartella `certs/` è in `.gitignore`: le chiavi private non vanno mai committate. È
un'impostazione solo per lo sviluppo — in produzione l'HTTPS lo fornisce l'hosting
(GitHub Pages), con un certificato pubblicamente valido e nessun avviso da accettare.

Il resto dell'app dal telefono funziona comunque, scegliendo i punti sulla mappa. Per
un accesso stabile senza computer acceso resta preferibile pubblicare su GitHub Pages,
che rende l'app installabile come PWA.

## 12. Build e deploy

### GitHub Pages

Il workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) installa le
dipendenze, esegue lint e test, compila e pubblica su GitHub Pages a ogni push su `main`.

Passaggi una tantum:

1. su GitHub: **Settings → Pages → Source: GitHub Actions**;
2. push su `main`.

Il percorso base viene ricavato automaticamente dal nome del repository
(`BASE_PATH=/<nome-repo>/`): non serve modificare il codice.

L’URL finale sarà `https://<utente>.github.io/<nome-repo>/`.

### Altri hosting

Qualsiasi hosting statico funziona: basta pubblicare `dist/`. Per un dominio alla radice
si può usare `BASE_PATH=/`.

## 13. Aggiornare i dati GIS

Il flusso è progettato perché l’aggiornamento sia una sostituzione di file, non una
modifica di codice:

```
QGIS  →  GeoPackage aggiornato  →  data/raw/  →  npm run data  →  public/data/  →  build  →  Pages
```

1. aggiorna i layer in QGIS e riesporta i `.gpkg`;
2. copia i file aggiornati in `data/raw/`;
3. esegui `npm run data`;
4. leggi `docs/data_audit_report.md`: se compaiono problemi bloccanti, correggi in QGIS e ripeti;
5. esegui `npm test` per verificare che il grafo resti coerente;
6. fai commit e push.

**I GeoJSON generati non vanno modificati a mano**: la modifica andrebbe persa alla
rigenerazione successiva. Le informazioni aggiunte manualmente (nomi ufficiali, stato)
vanno in `data/lines.json`, che la pipeline non sovrascrive nei campi compilati a mano —
se cambia lo schema, il file viene rigenerato e va reintegrato.

## 14. Variabili d’ambiente

Tutte facoltative: i default funzionano. Vedi [`.env.example`](.env.example).

| Variabile | Default | Uso |
|---|---|---|
| `VITE_BASEMAP_STYLE_URL` | Positron di OpenFreeMap | stile vettoriale della mappa |
| `VITE_BASEMAP_URL` | tile.openstreetmap.org | mattonelle raster di ripiego |
| `VITE_BASEMAP_ATTRIBUTION` | OSM + OpenFreeMap | attribuzione mostrata |
| `VITE_MAP_LABEL_FONT` | Noto Sans Bold | font delle etichette aggiunte dall’app |
| `VITE_GLYPHS_URL` | tiles.openfreemap.org | glifi usati con il ripiego raster |
| `VITE_GEOCODING_API_URL` | Nominatim | ricerca indirizzi |
| `VITE_GEOCODING_API_KEY` | *(vuota)* | se il provider la richiede |
| `VITE_REPORT_ISSUE_URL` | *(vuota)* | modulo/issue per le segnalazioni |
| `VITE_CYCLING_SPEED_KMH` | 15 | velocità usata per le stime in bici |
| `VITE_WALKING_SPEED_KMH` | 4.8 | velocità usata per i tratti a piedi |
| `VITE_WALK_LEG_MIN_METERS` | 20 | sotto questa soglia il tratto a piedi non viene mostrato |
| `VITE_SNAP_MAX_DISTANCE_METERS` | 700 | raggio entro cui il punto è considerato sulla rete |
| `VITE_WALK_SNAP_MAX_DISTANCE_METERS` | 40000 | raggio massimo entro cui si cerca la rete da un punto fuori area |
| `VITE_CONNECTOR_RIDE_THRESHOLD_METERS` | 500 | oltre questa lunghezza il raccordo si pedala invece di percorrerlo a piedi |
| `VITE_WALK_COST_FACTOR` | 2.2 | quanto pesa un minuto a piedi rispetto a uno pedalato |
| `VITE_WALK_SAFETY_WEIGHT` | 2.5 | quanto conta la pericolosità della via su cui ci si innesta |
| `VITE_WALK_ROUTING_MAX_DETOUR` | 2.5 | oltre questo rapporto sulla linea d’aria il giro pedonale è respinto |
| `VITE_ROUTE_VARIANT_MAX_DETOUR` | 1.4 | quanto una variante può allungare rispetto al percorso migliore |
| `VITE_ROUTE_VARIANT_MAX_BUSY_EXCESS` | 300 | metri di strade trafficate che una variante può aggiungere |
| `VITE_DANGER_BOOST` | 2 | quanto la penalità di pericolosità cresce più che proporzionalmente (0 = lineare) |
| `VITE_BUSY_ROAD_WARNING_METERS` | 150 | metri su statali/provinciali oltre i quali il percorso lo dichiara |
| `VITE_REROUTE_DISTANCE_THRESHOLD` | 45 | metri di scostamento prima del ricalcolo |
| `VITE_REROUTE_DEBOUNCE_MS` | 4000 | attesa prima di ricalcolare |
| `VITE_REROUTE_COOLDOWN_MS` | 8000 | attesa minima fra due ricalcoli consecutivi |
| `VITE_VOICE_PREPARE_METERS` | 300 | distanza a cui la voce annuncia la manovra in anticipo |
| `VITE_VOICE_NOW_METERS` | 60 | distanza a cui la voce annuncia la manovra da fare ora |
| `VITE_WALK_ROUTING_URL` | Valhalla OSM | rete pedonale per i tratti a piedi; vuoto = solo offline |
| `VITE_WALK_ROUTING_TIMEOUT_MS` | 6000 | oltre questa attesa si tiene il tratto in linea d’aria |
| `VITE_WALK_ROUTING_MIN_METERS` | 40 | sotto questa soglia il tratto non vale una chiamata |

`.env` è in `.gitignore`: nessuna chiave finisce nel repository.

## 15. Test

```bash
npm test
```

**200 test** su cinque gruppi:

- `tests/data/` — coerenza dei dati generati, e corrispondenza fra i file scritti
  dalla pipeline in `data/` e le copie pubblicate in `public/data/`: 15 linee, CRS, colori, nodi dentro l’area di
  Pesaro, nessun nome o stato inventato, anomalie note ancora segnalate;
- `tests/routing/` — percorsi reali fra luoghi **presi dai dati** (Parcheggio San Decenzio,
  Velomarche, Viale Trieste, Piazzale della Libertà, Via Solferino, Pista Cardinali), coerenza
  fra geometria e distanza dichiarata, comportamento dei profili, messaggi d’errore
  comprensibili, oltre al salvataggio su file di un itinerario e alla sua riapertura
  (ripristino identico, rifiuto dei file di altre applicazioni o di formato piu' recente,
  esportazione GPX con i caratteri speciali protetti);
- `tests/utils/` — geometria e formattazione, con verifica esplicita che l’interfaccia non
  mostri mai `undefined` o `NaN`;
- `tests/geocoding/` — ricerca nei dati locali del progetto: corrispondenze parziali,
  accenti e maiuscole, ordinamento dei risultati;
- `tests/navigation/` — guida vocale e segno della posizione: scelta della voce italiana
  maschile fra quelle installate, distanze scritte per essere pronunciate, annunci dati due
  volte e mai ripetuti, e ciclista animato che smette di chiedere fotogrammi da fermo.

I punti di test non sono coordinate inventate: ognuno corrisponde a una via nominata nel
grafo OSM o a un POI del GeoPackage.

## 16. Limiti attuali

- **Nomi ufficiali delle linee assenti**: il dataset contiene solo gli identificativi.
- **Colore della linea 13 di ripiego**: manca dalla simbologia QGIS.
- **Linee 2 e 5 con lo stesso colore**: ambiguità presente nel progetto originale.
- **Nessuna pendenza**: manca un modello digitale del terreno.
- **Nessun dato in tempo reale**: niente chiusure, lavori o traffico.
- **Nessun senso di marcia sulla Bicipolitana**: il dataset non lo contiene, quindi le
  linee sono percorribili in entrambe le direzioni. I sensi unici sono applicati solo alla
  viabilità ordinaria, dove OSM li dichiara.
- **Copertura limitata all’estratto OSM**: da un punto fuori da quell’area il percorso
  viene comunque calcolato, raccordando il punto alla rete con un tratto a piedi fino a
  40 km (`VITE_WALK_SNAP_MAX_DISTANCE_METERS`). Oltre quella distanza l’app dichiara che
  il punto è fuori area, invece di inventare un percorso.
- **I tratti a piedi dipendono da un servizio esterno**: il progetto GIS non contiene una
  rete pedonale, quindi il collegamento segue le strade solo quando il servizio pedonale
  (`VITE_WALK_ROUTING_URL`) risponde. Senza rete, o a servizio disattivato, torna a essere
  una linea d’aria che ignora muri, recinzioni e sensi di percorrenza pedonali —
  l’interfaccia dichiara in quale dei due casi si trova.
- **Tempi stimati**, non misurati.
- Il grafo (~457 KB compressi) va scaricato una volta: sulla prima visita in rete lenta
  l’attesa è percepibile; dalla seconda è servito dalla cache.

## 17. Sviluppi futuri

- Inserimento dei nomi ufficiali delle linee da fonte comunale.
- Modello digitale del terreno per considerare la pendenza.
- Feed ufficiale di chiusure e lavori, tramite `data/incidents.json`.
- Backend FastAPI + PostGIS + Valhalla/OSRM per routing su area più ampia: il codice è
  già separato in `services/routing/`, quindi basta un’implementazione alternativa
  dell’interfaccia del router.
- Statistiche personali e stima della CO₂ evitata, solo con un modello documentato.
- Segnalazioni degli utenti raccolte come issue GitHub.

## 18. Licenze e attribuzioni

- **Dati Bicipolitana**: progetto GIS `Pesaro2026` (Comune di Pesaro come fonte della rete).
- **Rete stradale, servizi, ostacoli, punti di svago**: © OpenStreetMap contributors,
  [ODbL](https://www.openstreetmap.org/copyright).
- **Basemap**: © [CARTO](https://carto.com/attributions), su dati OpenStreetMap.
- **Ortofoto/CTR** di supporto alla digitalizzazione: Regione Marche.
- **Codice**: licenza MIT, vedi [LICENSE](LICENSE).

Le attribuzioni sono sempre visibili nell’interfaccia e non sono rimovibili.
