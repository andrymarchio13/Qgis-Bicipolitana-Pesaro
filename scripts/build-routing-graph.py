#!/usr/bin/env python3
"""
FASE 3 - Costruzione del grafo di routing ciclabile.

Unisce in un unico grafo planarizzato:
  - le linee della Bicipolitana (data/raw/Linee_bicipolitana.gpkg)
  - la rete stradale OSM di Pesaro (data/raw/Strade_Pesaro.gpkg)

Procedimento:
  1. esplosione delle MultiLineString in LineString;
  2. calcolo di TUTTE le intersezioni reali fra archi (bici<->bici,
     bici<->strada, strada<->strada);
  3. rilevamento dei "near miss": coppie di archi piu' vicini della
     tolleranza di snap ma non intersecanti, collegati da archi
     connettori espliciti (la lunghezza del connettore e' il gap reale);
  4. taglio di ogni arco nei punti di intersezione -> archi elementari;
  5. fusione dei nodi con coordinate coincidenti (arrotondate al cm);
  6. attribuzione a ogni arco di: lunghezza, tipo, tag ciclabili,
     ostacoli entro un raggio configurabile, punteggio di sicurezza;
  7. analisi delle componenti connesse.

Output:
  data/routing/graph.json            grafo compatto per il frontend
  data/routing/topology_report.json  diagnostica topologica

NESSUN attributo viene inventato: cio' che manca resta null. I punteggi
derivati (safetyScore) sono calcolati da regole esplicite e dichiarate.
"""
from __future__ import annotations

import json
import math
import sys
import warnings as _warnings
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import nearest_points, substring
from shapely.strtree import STRtree
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).parent))
from gis_config import (  # noqa: E402
    CRS_METRIC, CRS_WEB, DEFAULT_CYCLING_SPEED_KMH, ROOT, ROUTING,
    SIMPLIFY_TOLERANCE_METERS, SOURCES, TOPOLOGY_SNAP_TOLERANCE_METERS,
)

_warnings.filterwarnings("ignore", "GeoSeries.notna", UserWarning)

_TO_WGS = Transformer.from_crs(CRS_METRIC, CRS_WEB, always_xy=True)

# --------------------------------------------------------------------------
# Parametri del modello (tutti configurabili e dichiarati come stime)
# --------------------------------------------------------------------------
NODE_PRECISION_CM = 2          # arrotondamento coordinate nodo (cm)
MIN_EDGE_LENGTH_M = 0.30       # archi piu' corti vengono collassati
OBSTACLE_INFLUENCE_RADIUS_M = 12.0   # distanza entro cui un ostacolo pesa su un arco
COORD_PRECISION_WEB = 5        # decimali nelle coordinate esportate (~1.1 m)

# Tolleranze di collegamento differenziate per provenienza dei dati.
#
# Le strade provengono da un unico estratto OSM: agli incroci reali i tratti
# condividono gia' lo stesso nodo, quindi due strade "vicine ma non
# intersecanti" sono di norma davvero separate (muro, argine, dislivello,
# sottopasso). Collegarle a 5 m creerebbe scorciatoie inesistenti: si usa
# quindi una tolleranza minima, sufficiente solo per gli artefatti di
# arrotondamento introdotti dalla riproiezione e dalla semplificazione.
#
# La Bicipolitana e' stata invece digitalizzata a parte su CTR/ortofoto e non
# condivide i nodi con OSM: per agganciarla alla rete serve la tolleranza
# topologica dichiarata in gis_config.
NEAR_MISS_TOLERANCE_ROAD_ROAD_M = 0.5
NEAR_MISS_TOLERANCE_BICIPOLITANA_M = TOPOLOGY_SNAP_TOLERANCE_METERS

# Gli archi non raggiungibili dalla componente principale vengono esclusi dal
# grafo esportato: agganciare origine o destinazione a un nodo isolato
# produrrebbe un "percorso non trovato" senza spiegazione per l'utente.
PRUNE_TO_MAIN_COMPONENT = True

# Punteggio di sicurezza: 1.0 = migliore, 0.0 = peggiore.
# Valori euristici e dichiarati, NON misurati sul campo.
SAFETY_BASE = {
    "cycleway": 1.00,
    "path": 0.85,
    "footway": 0.80,
    "pedestrian": 0.80,
    "living_street": 0.80,
    "track": 0.70,
    "service": 0.65,
    "residential": 0.60,
    "unclassified": 0.55,
    "tertiary": 0.40,
    "secondary": 0.25,
    "primary": 0.15,
    "trunk": 0.05,
}
SAFETY_DEFAULT = 0.50
SAFETY_BICIPOLITANA = 1.00

SAFETY_BONUS_DESIGNATED = 0.20   # bicycle=designated
SAFETY_BONUS_CYCLEWAY_TAG = 0.10  # corsia ciclabile su strada
SAFETY_BONUS_LIT = 0.05
SAFETY_MAXSPEED_PENALTY = {70: -0.20, 60: -0.15, 50: -0.10, 40: -0.05}
SAFETY_OBSTACLE_PENALTY = 0.15   # per ostacolo influente, cumulativo

# Superfici che rallentano la marcia (fattore moltiplicativo sul tempo).
SURFACE_SPEED_FACTOR = {
    "asphalt": 1.00, "paved": 1.00, "concrete": 0.98, "paving_stones": 0.92,
    "sett": 0.80, "cobblestone": 0.75, "compacted": 0.90, "fine_gravel": 0.85,
    "gravel": 0.75, "ground": 0.70, "dirt": 0.70, "earth": 0.70,
    "unpaved": 0.75, "grass": 0.60, "sand": 0.45, "wood": 0.85,
}

# Vie escluse dal grafo ciclabile: transito vietato o non pertinente.
EXCLUDED_HIGHWAY = {"motorway", "motorway_link", "trunk_link", "construction",
                    "proposed", "raceway", "bus_guideway", "escape"}


def to_wgs(x: float, y: float) -> list[float]:
    lon, lat = _TO_WGS.transform(x, y)
    return [round(lon, COORD_PRECISION_WEB), round(lat, COORD_PRECISION_WEB)]


def clean(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v != v:
        return None
    s = str(v).strip()
    return s or None


# --------------------------------------------------------------------------
# 1. Caricamento e normalizzazione delle sorgenti
# --------------------------------------------------------------------------
def load_inputs():
    """Ritorna la lista degli archi sorgente (geometria metrica + attributi)."""
    items: list[dict] = []

    # --- Bicipolitana
    path, layer = SOURCES["linee"]
    bici = gpd.read_file(path, layer=layer).to_crs(CRS_METRIC)
    skipped_bici = []
    for idx, row in bici.iterrows():
        line_id = clean(row["Nome_Linea"])
        geom = row.geometry
        if geom is None or geom.is_empty:
            skipped_bici.append({"feature": int(idx), "line": line_id,
                                 "reason": "geometria vuota"})
            continue
        if line_id is None:
            skipped_bici.append({"feature": int(idx), "reason": "Nome_Linea mancante"})
            continue
        parts = ([geom] if isinstance(geom, LineString)
                 else [g for g in geom.geoms if not g.is_empty])
        for p in parts:
            items.append({
                "geom": p.simplify(SIMPLIFY_TOLERANCE_METERS),
                "kind": "bicipolitana",
                "lineId": line_id,
                "sourceFeature": int(idx),
                "tags": {},
            })

    # --- Strade OSM
    path, layer = SOURCES["strade"]
    roads = gpd.read_file(path, layer=layer).to_crs(CRS_METRIC)
    keep = ["highway", "name", "bicycle", "cycleway", "cycleway:both",
            "cycleway:left", "cycleway:right", "surface", "smoothness",
            "maxspeed", "oneway", "oneway:bicycle", "access", "segregated",
            "lit", "foot", "osm_id", "tracktype", "width"]
    keep = [c for c in keep if c in roads.columns]
    skipped_roads = []
    for idx, row in roads.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty or not isinstance(geom, LineString):
            skipped_roads.append({"feature": int(idx), "reason": "geometria non valida"})
            continue
        tags = {c: clean(row[c]) for c in keep}
        tags = {k: v for k, v in tags.items() if v is not None}
        hw = tags.get("highway")
        if hw in EXCLUDED_HIGHWAY:
            skipped_roads.append({"feature": int(idx), "reason": f"highway={hw} escluso"})
            continue
        if tags.get("bicycle") == "no" and tags.get("foot") != "yes":
            skipped_roads.append({"feature": int(idx),
                                  "reason": "bicycle=no e nessun transito a piedi"})
            continue
        if tags.get("access") in ("private", "no") and tags.get("bicycle") not in (
                "yes", "designated", "permissive", "destination"):
            skipped_roads.append({"feature": int(idx),
                                  "reason": f"access={tags.get('access')}"})
            continue
        items.append({
            "geom": geom.simplify(SIMPLIFY_TOLERANCE_METERS),
            "kind": "road",
            "lineId": None,
            "sourceFeature": int(idx),
            "tags": tags,
        })

    return items, skipped_bici, skipped_roads


# --------------------------------------------------------------------------
# 2-3. Punti di taglio: intersezioni reali + near miss
# --------------------------------------------------------------------------
def pair_tolerance(kind_a: str, kind_b: str) -> float:
    """Tolleranza di near miss in funzione della provenienza dei due archi."""
    if kind_a == "bicipolitana" or kind_b == "bicipolitana":
        return NEAR_MISS_TOLERANCE_BICIPOLITANA_M
    return NEAR_MISS_TOLERANCE_ROAD_ROAD_M


def collect_split_points(items: list[dict], tol: float):
    geoms = [it["geom"] for it in items]
    tree = STRtree(geoms)

    splits: list[set[float]] = [set() for _ in items]  # distanze lungo l'arco
    near_miss: list[dict] = []
    crossings = 0
    seen_pairs: set[tuple[int, int]] = set()

    for i, g in enumerate(geoms):
        for j in tree.query(g.buffer(tol)):
            j = int(j)
            if j == i:
                continue
            pair = (i, j) if i < j else (j, i)
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            h = geoms[j]

            inter = g.intersection(h)
            if not inter.is_empty:
                pts = []
                gt = inter.geom_type
                if gt == "Point":
                    pts = [inter]
                elif gt == "MultiPoint":
                    pts = list(inter.geoms)
                elif gt in ("LineString", "MultiLineString"):
                    parts = [inter] if gt == "LineString" else list(inter.geoms)
                    for p in parts:
                        if p.is_empty:
                            continue
                        c = list(p.coords)
                        pts.extend([Point(c[0]), Point(c[-1])])
                elif gt == "GeometryCollection":
                    for p in inter.geoms:
                        if p.geom_type == "Point":
                            pts.append(p)
                        elif p.geom_type == "LineString" and not p.is_empty:
                            c = list(p.coords)
                            pts.extend([Point(c[0]), Point(c[-1])])
                for p in pts:
                    splits[i].add(g.project(p))
                    splits[j].add(h.project(p))
                crossings += len(pts)
                continue

            d = g.distance(h)
            if 0 < d <= pair_tolerance(items[i]["kind"], items[j]["kind"]):
                pi, pj = nearest_points(g, h)
                di, dj = g.project(pi), h.project(pj)
                splits[i].add(di)
                splits[j].add(dj)
                near_miss.append({
                    "edges": [i, j],
                    "distance_m": round(float(d), 3),
                    "at": [di, dj],
                    "kinds": [items[i]["kind"], items[j]["kind"]],
                    "lines": [items[i]["lineId"], items[j]["lineId"]],
                    "point_wgs84": to_wgs(pi.x, pi.y),
                })

    return splits, near_miss, crossings


# --------------------------------------------------------------------------
# 4-5. Taglio degli archi e costruzione dei nodi
# --------------------------------------------------------------------------
class NodeIndex:
    def __init__(self, precision_cm: int) -> None:
        self.q = 10 ** -precision_cm * 100  # non usato: vedi _key
        self.precision = precision_cm
        self.map: dict[tuple[int, int], int] = {}
        self.coords: list[tuple[float, float]] = []

    def _key(self, x: float, y: float) -> tuple[int, int]:
        f = 10 ** self.precision
        return (int(round(x * f)), int(round(y * f)))

    def get(self, x: float, y: float) -> int:
        k = self._key(x, y)
        if k in self.map:
            return self.map[k]
        nid = len(self.coords)
        self.map[k] = nid
        self.coords.append((x, y))
        return nid


def split_edges(items: list[dict], splits: list[set[float]], nodes: NodeIndex):
    edges: list[dict] = []
    # posizione (edge sorgente, distanza) -> nodo, per ricollegare i near miss
    anchor: dict[tuple[int, float], int] = {}

    for i, it in enumerate(items):
        g: LineString = it["geom"]
        total = g.length
        cuts = sorted({0.0, total} | {d for d in splits[i] if 0.0 < d < total})
        for a, b in zip(cuts, cuts[1:]):
            if b - a < MIN_EDGE_LENGTH_M:
                continue
            piece = substring(g, a, b)
            if piece.is_empty or piece.length < MIN_EDGE_LENGTH_M:
                continue
            coords = list(piece.coords)
            n_from = nodes.get(*coords[0][:2])
            n_to = nodes.get(*coords[-1][:2])
            if n_from == n_to and piece.length < MIN_EDGE_LENGTH_M:
                continue
            edges.append({
                "source": i,
                "from": n_from,
                "to": n_to,
                "geom": piece,
                "kind": it["kind"],
                "lineId": it["lineId"],
                "tags": it["tags"],
            })
        for d in cuts:
            p = g.interpolate(d)
            anchor[(i, round(d, 3))] = nodes.get(p.x, p.y)

    return edges, anchor


def add_connectors(near_miss, anchor, nodes, edges):
    """
    Collega i near miss.

    Se il divario e' inferiore alla lunghezza minima di un arco i due nodi
    sono di fatto lo stesso punto: vengono fusi, invece di generare un arco
    di lunghezza nulla che sporcherebbe il grafo. Sopra quella soglia il
    divario e' reale e viene rappresentato da un arco connettore la cui
    lunghezza e' esattamente il gap misurato.
    """
    added = 0
    merges: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()

    for nm in near_miss:
        i, j = nm["edges"]
        ni = anchor.get((i, round(nm["at"][0], 3)))
        nj = anchor.get((j, round(nm["at"][1], 3)))
        if ni is None or nj is None or ni == nj:
            continue
        key = (min(ni, nj), max(ni, nj))
        if key in seen:
            continue
        seen.add(key)

        ax, ay = nodes.coords[ni]
        bx, by = nodes.coords[nj]
        gap = math.hypot(bx - ax, by - ay)

        if gap < MIN_EDGE_LENGTH_M:
            merges.append((ni, nj))
            continue

        edges.append({
            "source": -1,
            "from": ni,
            "to": nj,
            "geom": LineString([(ax, ay), (bx, by)]),
            "kind": "connector",
            "lineId": None,
            "tags": {"note": "collegamento entro tolleranza di snap"},
        })
        added += 1

    return added, merges


def merge_nodes(nodes: "NodeIndex", edges: list[dict], merges: list[tuple[int, int]]) -> int:
    """Fonde le coppie di nodi coincidenti e rinumera il grafo."""
    if not merges:
        return 0

    parent = list(range(len(nodes.coords)))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b in merges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    representative = [find(i) for i in range(len(parent))]
    keep = sorted(set(representative))
    remap = {old: new for new, old in enumerate(keep)}

    new_coords = [nodes.coords[old] for old in keep]
    removed = len(nodes.coords) - len(new_coords)

    kept_edges = []
    for e in edges:
        e["from"] = remap[representative[e["from"]]]
        e["to"] = remap[representative[e["to"]]]
        # un arco che collassa su se stesso non ha piu' significato
        if e["from"] == e["to"] and e["geom"].length < MIN_EDGE_LENGTH_M:
            continue
        kept_edges.append(e)

    edges[:] = kept_edges
    nodes.coords = new_coords
    return removed


# --------------------------------------------------------------------------
# 6. Attributi degli archi
# --------------------------------------------------------------------------
def load_obstacles():
    path, layer = SOURCES["ostacoli"]
    g = gpd.read_file(path, layer=layer).to_crs(CRS_METRIC)
    g = g[~g.geometry.isna() & ~g.geometry.is_empty]
    out = []
    for i, (_, row) in enumerate(g.iterrows()):
        out.append({
            "id": f"obs-{i}",
            "geom": row.geometry,
            "bicycle": clean(row.get("bicycle")),
            "barrier": clean(row.get("barrier")),
        })
    return out


def bike_oneway(tags: dict) -> bool:
    """True se l'arco e' percorribile in bici in una sola direzione."""
    if tags.get("oneway:bicycle") == "no":
        return False
    if tags.get("oneway:bicycle") == "yes":
        return True
    return tags.get("oneway") in ("yes", "1", "-1", "true")


def bike_reversed(tags: dict) -> bool:
    return tags.get("oneway") == "-1" and tags.get("oneway:bicycle") != "no"


def has_cycle_lane(tags: dict) -> bool:
    for k in ("cycleway", "cycleway:both", "cycleway:left", "cycleway:right"):
        if tags.get(k) in ("lane", "track", "opposite_lane", "opposite_track",
                           "share_busway"):
            return True
    return False


def safety_score(kind: str, tags: dict, obstacle_count: int) -> float:
    if kind == "bicipolitana":
        s = SAFETY_BICIPOLITANA
    elif kind == "connector":
        s = 0.5
    else:
        s = SAFETY_BASE.get(tags.get("highway"), SAFETY_DEFAULT)
        if tags.get("bicycle") == "designated":
            s += SAFETY_BONUS_DESIGNATED
        if has_cycle_lane(tags):
            s += SAFETY_BONUS_CYCLEWAY_TAG
        if tags.get("lit") == "yes":
            s += SAFETY_BONUS_LIT
        try:
            ms = int(str(tags.get("maxspeed", "")).split()[0])
            for limit, pen in sorted(SAFETY_MAXSPEED_PENALTY.items(), reverse=True):
                if ms >= limit:
                    s += pen
                    break
        except (ValueError, IndexError):
            pass
    s -= SAFETY_OBSTACLE_PENALTY * obstacle_count
    return round(max(0.0, min(1.0, s)), 3)


def lit_flag(tags: dict) -> int | None:
    """1 se il tratto e' dichiarato illuminato, 0 se dichiarato non illuminato.

    None quando OSM non lo dice: il buio non si deduce dal silenzio dei dati.
    """
    value = tags.get("lit")
    if value in ("yes", "24/7", "automatic", "sunset-sunrise"):
        return 1
    if value in ("no", "disused"):
        return 0
    return None


def surface_factor(tags: dict) -> float:
    return SURFACE_SPEED_FACTOR.get(tags.get("surface"), 1.0)


def attach_obstacles(edges: list[dict], obstacles: list[dict]):
    if not obstacles:
        for e in edges:
            e["obstacles"] = []
        return 0
    tree = STRtree([o["geom"] for o in obstacles])
    matched = set()
    for e in edges:
        buf = e["geom"].buffer(OBSTACLE_INFLUENCE_RADIUS_M)
        hits = []
        for k in tree.query(buf):
            k = int(k)
            if obstacles[k]["geom"].distance(e["geom"]) <= OBSTACLE_INFLUENCE_RADIUS_M:
                hits.append(obstacles[k])
                matched.add(k)
        e["obstacles"] = hits
    return len(matched)


# --------------------------------------------------------------------------
# 7. Componenti connesse
# --------------------------------------------------------------------------
def connected_components(n_nodes: int, edges: list[dict]):
    adj = defaultdict(list)
    for idx, e in enumerate(edges):
        adj[e["from"]].append(e["to"])
        adj[e["to"]].append(e["from"])
    seen = [False] * n_nodes
    comps = []
    for s in range(n_nodes):
        if seen[s]:
            continue
        q = deque([s])
        seen[s] = True
        members = []
        while q:
            u = q.popleft()
            members.append(u)
            for v in adj[u]:
                if not seen[v]:
                    seen[v] = True
                    q.append(v)
        comps.append(members)
    comps.sort(key=len, reverse=True)
    return comps, adj


# --------------------------------------------------------------------------
def main() -> int:
    tol = TOPOLOGY_SNAP_TOLERANCE_METERS
    print(f"Tolleranza di snap: {tol} m")

    print("1/7 caricamento sorgenti...")
    items, skipped_bici, skipped_roads = load_inputs()
    n_bici = sum(1 for it in items if it["kind"] == "bicipolitana")
    print(f"    archi sorgente: {len(items)} (bicipolitana {n_bici}, "
          f"strade {len(items) - n_bici}) — esclusi {len(skipped_roads)} archi stradali")

    print("2/7 intersezioni e near miss...")
    splits, near_miss, crossings = collect_split_points(items, tol)
    print(f"    punti di intersezione: {crossings} — near miss: {len(near_miss)}")

    print("3/7 taglio archi e nodalizzazione...")
    nodes = NodeIndex(NODE_PRECISION_CM)
    edges, anchor = split_edges(items, splits, nodes)
    print(f"    archi elementari: {len(edges)} — nodi: {len(nodes.coords)}")

    print("4/7 archi connettori...")
    n_conn, merges = add_connectors(near_miss, anchor, nodes, edges)
    merged_nodes = merge_nodes(nodes, edges, merges)
    print(f"    connettori aggiunti: {n_conn} — nodi coincidenti fusi: {merged_nodes}")

    print("5/7 ostacoli...")
    obstacles = load_obstacles()
    matched = attach_obstacles(edges, obstacles)
    print(f"    ostacoli: {len(obstacles)} — associati ad almeno un arco: {matched}")

    print("6/8 analisi connettivita'...")
    comps_all, _ = connected_components(len(nodes.coords), edges)
    largest_all = comps_all[0] if comps_all else []
    pruned = {"nodes": 0, "edges": 0, "lengthKm": 0.0, "components": 0}

    if PRUNE_TO_MAIN_COMPONENT and len(comps_all) > 1:
        print("7/8 potatura alla componente principale...")
        keep_nodes = set(largest_all)
        kept_edges = [e for e in edges if e["from"] in keep_nodes]
        pruned = {
            "nodes": len(nodes.coords) - len(keep_nodes),
            "edges": len(edges) - len(kept_edges),
            "lengthKm": round(sum(e["geom"].length for e in edges
                                  if e["from"] not in keep_nodes) / 1000, 2),
            "components": len(comps_all) - 1,
        }
        # rinumerazione compatta dei nodi superstiti
        remap = {}
        new_coords = []
        for nid in sorted(keep_nodes):
            remap[nid] = len(new_coords)
            new_coords.append(nodes.coords[nid])
        for e in kept_edges:
            e["from"] = remap[e["from"]]
            e["to"] = remap[e["to"]]
        nodes.coords = new_coords
        edges = kept_edges
        print(f"    rimossi {pruned['nodes']} nodi, {pruned['edges']} archi "
              f"({pruned['lengthKm']} km) in {pruned['components']} componenti isolate")
    else:
        print("7/8 potatura non necessaria")

    print("8/8 attributi e costi...")
    lines_json = json.loads((ROOT / "data" / "lines.json").read_text(encoding="utf-8"))
    line_meta = {l["id"]: l for l in lines_json["lines"]}

    out_edges = []
    for idx, e in enumerate(edges):
        tags = e["tags"]
        length = float(e["geom"].length)
        obs = e["obstacles"]
        safety = safety_score(e["kind"], tags, len(obs))
        sfactor = surface_factor(tags)
        speed = DEFAULT_CYCLING_SPEED_KMH * sfactor
        # un ostacolo che impone di scendere dalla bici costa tempo aggiuntivo
        dismount = any(o["bicycle"] == "dismount" for o in obs)
        blocked = any(o["bicycle"] == "no" for o in obs)
        seconds = length / 1000 / speed * 3600
        # Un arco non puo' avere lunghezza o tempo nulli: la potatura e la
        # fusione dei nodi eliminano i casi degeneri, qui si applica comunque
        # un minimo per evitare divisioni per zero nel calcolo del percorso.
        length = max(length, MIN_EDGE_LENGTH_M)
        seconds = max(seconds, 0.1)

        rec = {
            "i": idx,
            "a": e["from"],
            "b": e["to"],
            "d": round(length, 1),
            "t": round(seconds, 1),
            "k": {"bicipolitana": 0, "road": 1, "connector": 2}[e["kind"]],
            "s": safety,
            "g": [to_wgs(x, y) for x, y, *_ in e["geom"].coords],
        }
        if e["lineId"]:
            rec["l"] = e["lineId"]
            rec["c"] = line_meta.get(e["lineId"], {}).get("color")
        if tags.get("highway"):
            rec["hw"] = tags["highway"]
        if tags.get("name"):
            rec["n"] = tags["name"]
        if tags.get("surface"):
            rec["sf"] = tags["surface"]
        # Illuminazione pubblica: serve a dire quanta strada si fara' al buio
        # se si torna dopo il tramonto. Il tag manca su molti tratti, e la sua
        # assenza NON viene letta come "non illuminata": resta assente, e chi
        # legge il grafo la tratta come informazione mancante.
        lit = lit_flag(tags)
        if lit is not None:
            rec["lt"] = lit
        if sfactor != 1.0:
            rec["sfc"] = sfactor
        if bike_oneway(tags):
            rec["ow"] = -1 if bike_reversed(tags) else 1
        if obs:
            rec["o"] = [o["id"] for o in obs]
        if dismount:
            rec["dm"] = 1
        if blocked:
            rec["bk"] = 1
        out_edges.append(rec)

    comps, adj = connected_components(len(nodes.coords), edges)
    largest = comps[0] if comps else []
    isolated = [c for c in comps if len(c) == 1]

    # copertura Bicipolitana nella componente principale
    in_main = set(largest)
    bici_edges = [e for e in edges if e["kind"] == "bicipolitana"]
    bici_in_main = [e for e in bici_edges if e["from"] in in_main]
    bici_len = sum(e["geom"].length for e in bici_edges)
    bici_len_main = sum(e["geom"].length for e in bici_in_main)

    lines_reachable = defaultdict(float)
    lines_total = defaultdict(float)
    for e in bici_edges:
        lines_total[e["lineId"]] += e["geom"].length
        if e["from"] in in_main:
            lines_reachable[e["lineId"]] += e["geom"].length

    graph = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "crs": CRS_WEB,
        "schema": {
            "nodes": "array [lon, lat]",
            "edges": {
                "i": "id", "a": "nodo iniziale", "b": "nodo finale",
                "d": "lunghezza in metri", "t": "tempo stimato in secondi",
                "k": "0=bicipolitana 1=strada 2=connettore",
                "s": "safetyScore 0..1 (euristico, dichiarato)",
                "g": "geometria [lon,lat][]",
                "l": "id linea Bicipolitana", "c": "colore linea",
                "hw": "tag highway OSM", "n": "nome via",
                "sf": "tag surface", "sfc": "fattore di velocita' per superficie",
                "lt": "1 illuminato, 0 non illuminato; assente = non dichiarato",
                "ow": "senso unico per bici: 1 = a->b, -1 = b->a",
                "o": "ostacoli entro il raggio di influenza",
                "dm": "presente ostacolo con obbligo di scendere",
                "bk": "presente ostacolo con transito vietato",
            },
        },
        "parameters": {
            "snapToleranceMeters": tol,
            "nearMissToleranceRoadToRoadMeters": NEAR_MISS_TOLERANCE_ROAD_ROAD_M,
            "nearMissToleranceBicipolitanaMeters": NEAR_MISS_TOLERANCE_BICIPOLITANA_M,
            "obstacleInfluenceRadiusMeters": OBSTACLE_INFLUENCE_RADIUS_M,
            "simplifyToleranceMeters": SIMPLIFY_TOLERANCE_METERS,
            "cyclingSpeedKmh": DEFAULT_CYCLING_SPEED_KMH,
            "minEdgeLengthMeters": MIN_EDGE_LENGTH_M,
            "note": "Velocita', punteggi di sicurezza e fattori di superficie sono "
                    "stime euristiche documentate, non misure di campo. La pendenza "
                    "non e' disponibile: il progetto GIS non contiene un modello "
                    "digitale del terreno.",
        },
        "nodes": [to_wgs(x, y) for x, y in nodes.coords],
        "edges": out_edges,
    }
    (ROUTING / "graph.json").write_text(
        json.dumps(graph, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    report = {
        "generatedAt": graph["generatedAt"],
        "parameters": graph["parameters"],
        "input": {
            "sourceEdges": len(items),
            "bicipolitanaSourceEdges": n_bici,
            "roadSourceEdges": len(items) - n_bici,
            "skippedBicipolitana": skipped_bici,
            "skippedRoadsCount": len(skipped_roads),
            "skippedRoadsReasons": dict(
                sorted(defaultdict(int, {
                    r["reason"]: sum(1 for s in skipped_roads if s["reason"] == r["reason"])
                    for r in skipped_roads}).items(), key=lambda kv: -kv[1])),
        },
        "graph": {
            "nodes": len(nodes.coords),
            "edges": len(edges),
            "bicipolitanaEdges": len(bici_edges),
            "roadEdges": sum(1 for e in edges if e["kind"] == "road"),
            "connectorEdges": n_conn,
            "mergedCoincidentNodes": merged_nodes,
            "intersectionPoints": crossings,
            "nearMissPairs": len(near_miss),
            "totalLengthKm": round(sum(e["geom"].length for e in edges) / 1000, 2),
            "bicipolitanaLengthKm": round(bici_len / 1000, 2),
        },
        "pruning": {
            "enabled": PRUNE_TO_MAIN_COMPONENT,
            "componentsBefore": len(comps_all),
            "removedComponents": pruned["components"],
            "removedNodes": pruned["nodes"],
            "removedEdges": pruned["edges"],
            "removedLengthKm": pruned["lengthKm"],
            "note": "archi non raggiungibili dalla componente principale, esclusi "
                    "dal grafo esportato per evitare percorsi impossibili",
        },
        "connectivity": {
            "components": len(comps),
            "largestComponentNodes": len(largest),
            "largestComponentShare": round(len(largest) / max(1, len(nodes.coords)), 4),
            "isolatedNodes": len(isolated),
            "componentSizesTop10": [len(c) for c in comps[:10]],
            "bicipolitanaInMainComponentKm": round(bici_len_main / 1000, 2),
            "bicipolitanaInMainComponentShare": round(
                bici_len_main / bici_len, 4) if bici_len else 0,
            "perLine": {
                lid: {
                    "totalKm": round(lines_total[lid] / 1000, 2),
                    "inMainComponentKm": round(lines_reachable[lid] / 1000, 2),
                    "share": round(lines_reachable[lid] / lines_total[lid], 4)
                    if lines_total[lid] else 0,
                }
                for lid in sorted(lines_total,
                                  key=lambda k: (0, int(k)) if k.isdigit() else (1, k))
            },
        },
        "nearMissTolerances": {
            "roadToRoadMeters": NEAR_MISS_TOLERANCE_ROAD_ROAD_M,
            "bicipolitanaMeters": NEAR_MISS_TOLERANCE_BICIPOLITANA_M,
        },
        "nearMiss": sorted(near_miss, key=lambda x: -x["distance_m"])[:60],
        "obstacles": {
            "total": len(obstacles),
            "attachedToEdges": matched,
            "edgesWithObstacles": sum(1 for e in edges if e["obstacles"]),
            "edgesWithDismount": sum(1 for e in out_edges if e.get("dm")),
            "edgesBlocked": sum(1 for e in out_edges if e.get("bk")),
        },
    }
    (ROUTING / "topology_report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    size = (ROUTING / "graph.json").stat().st_size
    print()
    print(f"  nodi                     : {len(nodes.coords)}")
    print(f"  archi                    : {len(edges)}")
    print(f"  di cui Bicipolitana      : {len(bici_edges)}")
    print(f"  componenti connesse      : {len(comps)}")
    print(f"  componente principale    : {len(largest)} nodi "
          f"({report['connectivity']['largestComponentShare'] * 100:.1f}%)")
    print(f"  Bicipolitana raggiungibile: "
          f"{report['connectivity']['bicipolitanaInMainComponentShare'] * 100:.1f}% "
          f"({report['connectivity']['bicipolitanaInMainComponentKm']} km)")
    print(f"  graph.json               : {size / 1024:.0f} KB")
    print("\n-> data/routing/graph.json")
    print("-> data/routing/topology_report.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
