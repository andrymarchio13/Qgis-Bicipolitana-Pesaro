# Data Audit Report — Bicipolitana Pesaro

Generato automaticamente da `scripts/validate-gis.py` il 2026-08-31T19:57:16+00:00.

Sorgente: progetto QGIS `Pesaro2026.qgz` e GeoPackage associati (copiati intatti in `data/raw/`).

> Nessun dato è stato inventato. Dove un'informazione non è presente nel dataset originale, viene dichiarata come mancante.


## 1. Inventario dei layer

| Layer | File | Feature | Geometria | CRS | Campi popolati / totali |
|---|---|---|---|---|---|
| `linee_bicipolitana` | Linee_bicipolitana.gpkg | 18 | MultiLineString (18) | EPSG:3004 | 1 / 1 |
| `servizi_bicipolitana` | servizi_bicipolitana.gpkg | 35 | Point (35) | EPSG:3004 | 30 / 30 |
| `ostacoli_bicipolitana` | Ostacoli.gpkg | 31 | Point (31) | EPSG:3004 | 12 / 12 |
| `punti_svago` | Svago.gpkg | 12 | Point (12) | EPSG:3004 | 14 / 14 |
| `strade` | Strade_Pesaro.gpkg | 5208 | LineString (5208) | EPSG:3004 | 123 / 123 |

### Estensione geografica

| Layer | BBox WGS84 (lon/lat) | Lunghezza totale |
|---|---|---|
| `linee_bicipolitana` | 12.83721, 43.87867 → 12.96063, 43.92358 | 61.06 km |
| `servizi_bicipolitana` | 12.87209, 43.89037 → 12.94186, 43.91957 | — |
| `ostacoli_bicipolitana` | 12.88614, 43.89191 → 12.92160, 43.92265 | — |
| `punti_svago` | 12.87824, 43.88918 → 12.94622, 43.92878 | — |
| `strade` | 12.83306, 43.83672 → 12.99316, 43.93774 | 678.80 km |

## 2. Qualità delle geometrie

| Layer | Nulle | Vuote | Non valide | Duplicati esatti |
|---|---|---|---|---|
| `linee_bicipolitana` | 0 | 1 | 0 | 0 |
| `servizi_bicipolitana` | 0 | 0 | 0 | 0 |
| `ostacoli_bicipolitana` | 0 | 0 | 0 | 0 |
| `punti_svago` | 0 | 0 | 0 | 0 |
| `strade` | 0 | 0 | 0 | 0 |

## 3. Linee della Bicipolitana

Campo identificativo: **`Nome_Linea`** — 15 linee distinte rilevate: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, A, B.

| Linea | Feature sorgente | Tronconi grezzi | Dopo merge | Contigua | Lunghezza | Colore QGIS |
|---|---|---|---|---|---|---|
| 1 | 0 | 1 | 1 | sì | 3.83 km | #e31a1c |
| 2 | 1 | 1 | 1 | sì | 6.26 km | #1f78b4 |
| 3 | 2 | 1 | 1 | sì | 9.54 km | #33a02c |
| 4 | 4 | 1 | 1 | sì | 2.58 km | #a6c78a |
| 5 | 5, 6 | 2 | 2 | no | 6.21 km | #1f78b4 |
| 6 | 7 | 1 | 1 | sì | 1.15 km | #f6e953 |
| 7 | 8, 9 | 2 | 2 | no | 5.36 km | #d029b2 |
| 8 | 10 | 1 | 1 | sì | 1.8 km | #cc4ec3 |
| 9 | 11 | 1 | 1 | sì | 2.25 km | #daa7ce |
| 10 | 12 | 1 | 1 | sì | 2.45 km | #1c5119 |
| 11 | 13 | 1 | 1 | sì | 2.64 km | #a0100e |
| 12 | 14 | 1 | 1 | sì | 1.53 km | #fdbf6f |
| 13 | 15 | 1 | 1 | sì | 6.16 km | **assente** |
| A | 16 | 1 | 1 | sì | 6.27 km | #ff7f00 |
| B | 17 | 1 | 1 | sì | 3.03 km | #68532b |

**Lunghezza totale rete Bicipolitana:** 61.06 km


### 3.1 Problemi rilevati sulle linee

- ⚠️ Feature `3` (linea 3): geometria nulla o vuota - esclusa dal routing
- ⚠️ Linee senza categoria/colore nella simbologia QGIS: **13**. Il colore dovrà essere confermato da fonte ufficiale in `data/lines.json`.
- ⚠️ Colore `#1f78b4` condiviso dalle linee 2, 5: ambiguo sulla mappa, da disambiguare.

### 3.2 Discontinuità interne alle linee

| Linea | Tronconi | Distanza | Entro tolleranza snap |
|---|---|---|---|
| 5 | 0–1 | 0.0 m | sì |
| 7 | 0–1 | 0.0 m | sì |

### 3.3 Intersezioni e interscambi fra linee

Tolleranza di snapping: `TOPOLOGY_SNAP_TOLERANCE_METERS = 5.0 m` (parametro configurabile, non un dato rilevato).

Rilevate **31** coppie di linee in contatto:

| Linee | Tipo | Distanza | Punto (lon, lat) |
|---|---|---|---|
| 1 ↔ 11 | near-miss (entro tolleranza di snap) | 2.48 m | 12.903252, 43.911406 |
| 1 ↔ 2 | crossing | 0.0 m | 12.917939, 43.913724 |
| 1 ↔ 4 | crossing | 0.0 m | 12.915069, 43.908777 |
| 1 ↔ 6 | near-miss (entro tolleranza di snap) | 1.35 m | 12.907593, 43.905862 |
| 1 ↔ 8 | near-miss (entro tolleranza di snap) | 3.0 m | 12.906346, 43.906137 |
| 10 ↔ 11 | crossing | 0.0 m | 12.894669, 43.908827 |
| 10 ↔ 13 | crossing | 0.0 m | 12.890313, 43.904426 |
| 10 ↔ 3 | crossing | 0.0 m | 12.891226, 43.903919 |
| 10 ↔ A | crossing | 0.0 m | 12.889652, 43.905429 |
| 11 ↔ 3 | crossing | 0.0 m | 12.897103, 43.908013 |
| 12 ↔ 13 | crossing | 0.0 m | 12.870826, 43.909039 |
| 12 ↔ 3 | crossing | 0.0 m | 12.875991, 43.907817 |
| 12 ↔ A | crossing | 0.0 m | 12.870608, 43.90897 |
| 13 ↔ 3 | crossing | 0.0 m | 12.89123, 43.903921 |
| 13 ↔ 5 | crossing | 0.0 m | 12.910595, 43.89598 |
| 13 ↔ 7 | crossing | 0.0 m | 12.898567, 43.899022 |
| 13 ↔ 8 | crossing | 0.0 m | 12.897837, 43.899501 |
| 13 ↔ 9 | crossing | 0.0 m | 12.894094, 43.902138 |
| 13 ↔ A | crossing | 0.0 m | 12.883129, 43.906659 |
| 2 ↔ 5 | crossing | 0.0 m | 12.930981, 43.90452 |
| 3 ↔ A | crossing | 0.0 m | 12.891336, 43.904029 |
| 4 ↔ 5 | crossing | 0.0 m | 12.917672, 43.904693 |
| 5 ↔ 7 | crossing | 0.0 m | 12.908245, 43.891481 |
| 5 ↔ A | crossing | 0.0 m | 12.910597, 43.895987 |
| 5 ↔ B | crossing | 0.0 m | 12.909452, 43.887149 |
| 7 ↔ 8 | near-miss (entro tolleranza di snap) | 1.91 m | 12.893536, 43.894998 |
| 7 ↔ 9 | crossing | 0.0 m | 12.902955, 43.90265 |
| 7 ↔ A | crossing | 0.0 m | 12.898547, 43.899058 |
| 8 ↔ 9 | crossing | 0.0 m | 12.902422, 43.902245 |
| 8 ↔ A | crossing | 0.0 m | 12.897829, 43.899495 |
| 9 ↔ A | crossing | 0.0 m | 12.894133, 43.902153 |

### 3.4 Connettività della rete

Analisi svolta **sui soli estremi** dei tronconi: due linee che si toccano a metà percorso (attraversamento) risultano qui separate. La nodalizzazione dei punti di attraversamento avviene nella costruzione del grafo di routing (`build-routing-graph.py`), che spezza gli archi in corrispondenza delle intersezioni elencate al §3.3.

- Tronconi (archi a livello di linea): **17**
- Nodi terminali distinti (dopo snap a 5.0 m): **31**
- Componenti connesse considerando i soli estremi: **14** (dimensioni: [3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2])
- Coppie di linee in contatto per attraversamento o prossimità: **31** (§3.3) — sono questi i punti che rendono la rete percorribile come grafo unico.

## 4. Rete stradale di supporto (routing)

- Archi: **5208** — lunghezza totale **678.8 km** — archi con nome: **2588**

| Tag `highway` | Archi |
|---|---|
| `service` | 1724 |
| `residential` | 1543 |
| `unclassified` | 456 |
| `tertiary` | 376 |
| `cycleway` | 355 |
| `path` | 252 |
| `primary` | 243 |
| `track` | 155 |
| `secondary` | 98 |
| `services` | 5 |
| `secondary_link` | 1 |

Tag rilevanti per la ciclabilità effettivamente presenti nel dataset:

- `bicycle`: designated=185, yes=36, no=18, permissive=13, dismount=4, destination=1, private=1, permit=1
- `cycleway`: crossing=45, no=5, lane=4, separate=2
- `cycleway:both`: no=103, shoulder=29, lane=3, separate=1
- `cycleway:left`: share_busway=6, separate=5, lane=5, no=1
- `cycleway:right`: no=62, lane=18, separate=7
- `surface`: asphalt=3277, sett=185, paved=115, unpaved=32, concrete=29, ground=28, paving_stones=25, compacted=25, fine_gravel=10, gravel=7, earth=7, grass=6
- `maxspeed`: 50=226, 30=145, 20=20, 70=9, 40=4, 60=3, 5=2
- `oneway`: yes=1496, no=196, alternating=1
- `access`: private=47, no=18, destination=6, customers=2, yes=1, permissive=1, permit=1
- `segregated`: no=232, yes=124
- `lit`: yes=1053, no=19
- `smoothness`: good=45, excellent=7, intermediate=7, very_bad=3, bad=2, horrible=2

## 5. Punti di interesse


### servizi

- `amenity`: **drinking_water** (26), **bicycle_parking** (3), **bicycle_rental** (2)
- `shop`: **bicycle** (4)
- `man_made`: **water_tap** (10)
- `bicycle_parking`: **stands** (2)
- `bicycle_rental`: **dropoff_point** (1)
- `service:bicycle:repair`: **yes** (1)
- `service:bicycle:pump`: **yes** (1)
- `access`: **yes** (2)
- `fee`: **no** (2)

### ostacoli

- `barrier`: **cycle_barrier** (31)
- `cycle_barrier`: **double** (2), **triple** (1)
- `bicycle`: **yes** (16), **dismount** (6), **no** (1)
- `foot`: **yes** (26)
- `access`: **no** (2)
- `maxwidth`: **1** (3)
- `locked`: **no** (2)

### svago

- `leisure`: **park** (3)
- `tourism`: **viewpoint** (8), **picnic_site** (1)
- `amenity`: **bench** (1)
- `man_made`: **optical_viewer** (1)

## 6. Esito

**✅ VALIDAZIONE SUPERATA** — è possibile procedere alla costruzione del grafo di routing.


Avvertenze non bloccanti:

- ⚠️ Layer `linee_bicipolitana`: 0 geometrie nulle e 1 vuote — escluse dalle elaborazioni.
- ⚠️ Linee prive di colore nella simbologia QGIS: 13
- ⚠️ Colore #1f78b4 condiviso da linee 2, 5.
- ⚠️ La rete Bicipolitana ha 14 componenti non connesse a livello di estremi; la connessione effettiva passa dai 31 attraversamenti fra linee, nodalizzati nel grafo di routing.
