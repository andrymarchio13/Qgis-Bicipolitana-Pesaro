#!/usr/bin/env python3
"""
FASE 1 - Analisi e validazione del materiale GIS originale.

Non modifica nulla: legge i GeoPackage in data/raw/ (copie dei file del
progetto QGIS Pesaro2026) e produce:

  docs/data_audit_report.md       report leggibile
  data/metadata/validation.json   stesso contenuto in forma strutturata

Il routing NON deve essere costruito se questo script segnala errori
bloccanti (blocking_issues non vuoto).
"""
from __future__ import annotations

import json
import sys
import warnings as _warnings
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge
from shapely.strtree import STRtree
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).parent))
from gis_config import (  # noqa: E402
    CRS_METRIC, CRS_SOURCE, CRS_WEB, DOCS, METADATA, QGZ, SOURCES,
    TOPOLOGY_GAP_REPORT_METERS, TOPOLOGY_SNAP_TOLERANCE_METERS,
)

_warnings.filterwarnings("ignore", "GeoSeries.notna", UserWarning)

_TO_WGS = Transformer.from_crs(CRS_METRIC, CRS_WEB, always_xy=True)


def to_wgs(x: float, y: float) -> list[float]:
    lon, lat = _TO_WGS.transform(x, y)
    return [round(lon, 6), round(lat, 6)]


# --------------------------------------------------------------------------
# Simbologia QGIS
# --------------------------------------------------------------------------
def extract_qgis_symbology(qgz: Path) -> dict:
    """Legge i colori della simbologia categorizzata dal progetto .qgz."""
    out: dict = {"layers": {}, "readable": qgz.exists()}
    if not qgz.exists():
        return out
    with zipfile.ZipFile(qgz) as z:
        qgs_name = next(n for n in z.namelist() if n.endswith(".qgs"))
        root = ET.fromstring(z.read(qgs_name).decode("utf-8"))

    for ml in root.iter("maplayer"):
        lname = ml.findtext("layername")
        renderer = ml.find("renderer-v2")
        if renderer is None:
            continue
        entry = {
            "renderer": renderer.get("type"),
            "attribute": renderer.get("attr"),
            "categories": {},
            "symbol_colors": {},
        }
        for sym in renderer.iter("symbol"):
            for opt in sym.iter("Option"):
                if opt.get("name") in ("line_color", "color"):
                    entry["symbol_colors"].setdefault(sym.get("name"), opt.get("value"))
        for cat in renderer.iter("category"):
            entry["categories"][str(cat.get("value"))] = {
                "label": cat.get("label"),
                "symbol": cat.get("symbol"),
                "render": cat.get("render"),
            }
        out["layers"][lname] = entry
    return out


def qgis_color_to_hex(value: str | None) -> str | None:
    """'227,26,28,255,rgb:...' -> '#e31a1c'."""
    if not value:
        return None
    parts = value.split(",")
    try:
        r, g, b = (int(parts[i]) for i in range(3))
    except (ValueError, IndexError):
        return None
    return f"#{r:02x}{g:02x}{b:02x}"


# --------------------------------------------------------------------------
# Utility geometriche
# --------------------------------------------------------------------------
def explode_lines(geom):
    """MultiLineString -> lista di LineString. Ignora geometrie vuote/nulle."""
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom]
    if isinstance(geom, MultiLineString):
        return [g for g in geom.geoms if not g.is_empty]
    return []


def endpoints(line: LineString):
    c = list(line.coords)
    return c[0], c[-1]


def merged_parts_of(parts: list[LineString]) -> list[LineString]:
    if not parts:
        return []
    if len(parts) == 1:
        return parts
    return explode_lines(linemerge(MultiLineString(parts)))


# --------------------------------------------------------------------------
# Analisi di un layer generico
# --------------------------------------------------------------------------
def analyse_layer(key: str, path: Path, layer: str):
    gdf = gpd.read_file(path, layer=layer)
    declared_crs = str(gdf.crs) if gdf.crs else None
    metric = gdf.to_crs(CRS_METRIC) if declared_crs != CRS_METRIC else gdf

    null_geom = [int(i) for i in gdf.index[gdf.geometry.isna()]]
    empty_geom = [int(i) for i in gdf.index[
        ~gdf.geometry.isna() & gdf.geometry.apply(lambda g: g.is_empty)]]
    invalid = [int(i) for i in gdf.index[
        ~gdf.geometry.isna() & ~gdf.geometry.is_valid]]

    valid = metric[~metric.geometry.isna() & ~metric.geometry.is_empty]
    bounds_m = [round(v, 2) for v in valid.total_bounds] if len(valid) else None
    bbox_wgs = None
    if bounds_m:
        sw = to_wgs(bounds_m[0], bounds_m[1])
        ne = to_wgs(bounds_m[2], bounds_m[3])
        bbox_wgs = [sw[0], sw[1], ne[0], ne[1]]

    populated = {}
    for col in gdf.columns:
        if col == gdf.geometry.name:
            continue
        n = int(gdf[col].notna().sum())
        if n:
            populated[col] = n

    result = {
        "key": key,
        "file": path.name,
        "layer": layer,
        "feature_count": int(len(gdf)),
        "geometry_types": {k: int(v) for k, v in gdf.geom_type.value_counts().items()},
        "crs_declared": declared_crs,
        "crs_matches_project": declared_crs == CRS_SOURCE,
        "bbox_metric_epsg3004": bounds_m,
        "bbox_wgs84": bbox_wgs,
        "null_geometries": null_geom,
        "empty_geometries": empty_geom,
        "invalid_geometries": invalid,
        "attribute_fields_total": int(len(gdf.columns) - 1),
        "attribute_fields_populated": len(populated),
        "populated_fields": dict(sorted(populated.items(), key=lambda kv: -kv[1])),
    }

    if len(valid) and valid.geom_type.isin(["LineString", "MultiLineString"]).any():
        result["total_length_m"] = round(float(valid.length.sum()), 1)

    wkb_seen: dict[bytes, int] = {}
    dups = []
    for idx, geom in zip(valid.index, valid.geometry):
        w = geom.wkb
        if w in wkb_seen:
            dups.append({"feature": int(idx), "duplicate_of": wkb_seen[w]})
        else:
            wkb_seen[w] = int(idx)
    result["exact_duplicate_geometries"] = dups

    return result, metric


# --------------------------------------------------------------------------
# Analisi topologica della Bicipolitana
# --------------------------------------------------------------------------
def analyse_bicipolitana(metric: gpd.GeoDataFrame, symbology: dict) -> dict:
    tol = TOPOLOGY_SNAP_TOLERANCE_METERS
    field = "Nome_Linea"

    lines: dict[str, dict] = {}
    unusable: list[dict] = []

    for idx, row in metric.iterrows():
        name = row[field]
        geom = row.geometry
        key = None if name is None else str(name).strip()
        if key in (None, ""):
            unusable.append({"feature": int(idx), "reason": "Nome_Linea mancante"})
            continue
        entry = lines.setdefault(
            key, {"id": key, "features": [], "parts": [], "empty_features": []})
        parts = explode_lines(geom)
        if not parts:
            entry["empty_features"].append(int(idx))
            unusable.append({
                "feature": int(idx),
                "line": key,
                "reason": "geometria nulla o vuota - esclusa dal routing",
            })
            continue
        entry["features"].append(int(idx))
        entry["parts"].extend(parts)

    sym = symbology["layers"].get("Linee_Bicipolitana", {})
    cats = sym.get("categories", {})
    colors = sym.get("symbol_colors", {})
    color_by_line = {}
    for value, cat in cats.items():
        color_by_line[value] = qgis_color_to_hex(colors.get(cat["symbol"]))

    report_lines = []
    geoms: list[LineString] = []
    owners: list[str] = []

    for key, entry in lines.items():
        parts = entry["parts"]
        length = sum(p.length for p in parts)
        mparts = merged_parts_of(parts)

        gaps = []
        if len(mparts) > 1:
            for i in range(len(mparts)):
                for j in range(i + 1, len(mparts)):
                    d = mparts[i].distance(mparts[j])
                    gaps.append({
                        "between_parts": [i, j],
                        "distance_m": round(float(d), 2),
                        "within_snap_tolerance": bool(d <= tol),
                    })
            gaps.sort(key=lambda g: g["distance_m"])

        eps = []
        for p in mparts:
            a, b = endpoints(p)
            eps.append({"start": to_wgs(*a[:2]), "end": to_wgs(*b[:2])})

        for p in mparts:
            geoms.append(p)
            owners.append(key)

        report_lines.append({
            "id": key,
            "source_features": entry["features"],
            "empty_features": entry["empty_features"],
            "raw_parts": len(parts),
            "merged_parts": len(mparts),
            "contiguous": len(mparts) == 1,
            "length_m": round(float(length), 1),
            "length_km": round(float(length) / 1000, 2),
            "endpoints": eps,
            "internal_gaps": gaps,
            "color_from_qgis": color_by_line.get(key),
            "has_qgis_category": key in cats,
        })

    def sort_key(l):
        return (0, int(l["id"])) if l["id"].isdigit() else (1, l["id"])

    report_lines.sort(key=sort_key)

    # intersezioni fra linee diverse
    tree = STRtree(geoms)
    seen: set[tuple[str, str]] = set()
    intersections = []
    for i, g in enumerate(geoms):
        for j in tree.query(g.buffer(tol)):
            j = int(j)
            if owners[i] == owners[j]:
                continue
            pair = tuple(sorted((owners[i], owners[j])))
            if pair in seen:
                continue
            d = float(g.distance(geoms[j]))
            if d > tol:
                continue
            seen.add(pair)
            inter = g.intersection(geoms[j])
            if not inter.is_empty:
                pt = inter if inter.geom_type == "Point" else inter.representative_point()
                kind = "crossing"
            else:
                pt = g.interpolate(g.project(geoms[j].centroid))
                kind = "near-miss (entro tolleranza di snap)"
            intersections.append({
                "lines": list(pair),
                "type": kind,
                "distance_m": round(d, 2),
                "point_wgs84": to_wgs(pt.x, pt.y),
            })
    intersections.sort(key=lambda x: (x["lines"][0], x["lines"][1]))

    # connettivita' globale della rete (union-find con snapping a griglia)
    node_of: dict[tuple[int, int], int] = {}
    parent: list[int] = []

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    def node_id(pt) -> int:
        cell = (int(pt[0] // tol), int(pt[1] // tol))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                c = (cell[0] + dx, cell[1] + dy)
                if c in node_of:
                    return node_of[c]
        nid = len(parent)
        parent.append(nid)
        node_of[cell] = nid
        return nid

    edge_count = 0
    for g in geoms:
        a, b = endpoints(g)
        na, nb = node_id(a[:2]), node_id(b[:2])
        union(na, nb)
        edge_count += 1

    comps: dict[int, int] = defaultdict(int)
    for n in range(len(parent)):
        comps[find(n)] += 1
    components = sorted(comps.values(), reverse=True)

    return {
        "snap_tolerance_m": tol,
        "gap_report_threshold_m": TOPOLOGY_GAP_REPORT_METERS,
        "distinct_lines": len(report_lines),
        "line_ids": [l["id"] for l in report_lines],
        "lines": report_lines,
        "unusable_features": unusable,
        "intersections": intersections,
        "network_nodes_approx": len(parent),
        "network_edges_approx": edge_count,
        "endpoint_connected_components": len(components),
        "endpoint_component_sizes": components,
        "lines_without_qgis_color": [l["id"] for l in report_lines if not l["color_from_qgis"]],
        "duplicate_colors": _duplicate_colors(report_lines),
    }


def _duplicate_colors(report_lines: list[dict]) -> list[dict]:
    by_color: dict[str, list[str]] = defaultdict(list)
    for l in report_lines:
        if l["color_from_qgis"]:
            by_color[l["color_from_qgis"]].append(l["id"])
    return [{"color": c, "lines": ids} for c, ids in by_color.items() if len(ids) > 1]


# --------------------------------------------------------------------------
# Report markdown
# --------------------------------------------------------------------------
def write_markdown(v: dict, out: Path) -> None:
    L: list[str] = []
    a = L.append
    a("# Data Audit Report — Bicipolitana Pesaro\n")
    a(f"Generato automaticamente da `scripts/validate-gis.py` il {v['generated_at']}.\n")
    a("Sorgente: progetto QGIS `Pesaro2026.qgz` e GeoPackage associati "
      "(copiati intatti in `data/raw/`).\n")
    a("> Nessun dato è stato inventato. Dove un'informazione non è presente nel "
      "dataset originale, viene dichiarata come mancante.\n")

    a("\n## 1. Inventario dei layer\n")
    a("| Layer | File | Feature | Geometria | CRS | Campi popolati / totali |")
    a("|---|---|---|---|---|---|")
    for ly in v["layers"]:
        gt = ", ".join(f"{k} ({n})" for k, n in ly["geometry_types"].items()) or "—"
        a(f"| `{ly['layer']}` | {ly['file']} | {ly['feature_count']} | {gt} | "
          f"{ly['crs_declared']} | {ly['attribute_fields_populated']} / "
          f"{ly['attribute_fields_total']} |")

    a("\n### Estensione geografica\n")
    a("| Layer | BBox WGS84 (lon/lat) | Lunghezza totale |")
    a("|---|---|---|")
    for ly in v["layers"]:
        bb = ly["bbox_wgs84"]
        bbs = f"{bb[0]:.5f}, {bb[1]:.5f} → {bb[2]:.5f}, {bb[3]:.5f}" if bb else "—"
        ln = f"{ly['total_length_m'] / 1000:.2f} km" if "total_length_m" in ly else "—"
        a(f"| `{ly['layer']}` | {bbs} | {ln} |")

    a("\n## 2. Qualità delle geometrie\n")
    a("| Layer | Nulle | Vuote | Non valide | Duplicati esatti |")
    a("|---|---|---|---|---|")
    for ly in v["layers"]:
        a(f"| `{ly['layer']}` | {len(ly['null_geometries'])} | "
          f"{len(ly['empty_geometries'])} | {len(ly['invalid_geometries'])} | "
          f"{len(ly['exact_duplicate_geometries'])} |")

    t = v["bicipolitana_topology"]
    a("\n## 3. Linee della Bicipolitana\n")
    a(f"Campo identificativo: **`Nome_Linea`** — {t['distinct_lines']} linee distinte "
      f"rilevate: {', '.join(t['line_ids'])}.\n")
    a("| Linea | Feature sorgente | Tronconi grezzi | Dopo merge | Contigua | Lunghezza | Colore QGIS |")
    a("|---|---|---|---|---|---|---|")
    for l in t["lines"]:
        col = l["color_from_qgis"] or "**assente**"
        a(f"| {l['id']} | {', '.join(map(str, l['source_features'])) or '—'} | "
          f"{l['raw_parts']} | {l['merged_parts']} | "
          f"{'sì' if l['contiguous'] else 'no'} | {l['length_km']} km | {col} |")

    a(f"\n**Lunghezza totale rete Bicipolitana:** "
      f"{sum(l['length_m'] for l in t['lines']) / 1000:.2f} km\n")

    a("\n### 3.1 Problemi rilevati sulle linee\n")
    if t["unusable_features"]:
        for u in t["unusable_features"]:
            suffix = f" (linea {u['line']})" if "line" in u else ""
            a(f"- ⚠️ Feature `{u['feature']}`{suffix}: {u['reason']}")
    else:
        a("- Nessuna feature inutilizzabile.")
    if t["lines_without_qgis_color"]:
        a(f"- ⚠️ Linee senza categoria/colore nella simbologia QGIS: "
          f"**{', '.join(t['lines_without_qgis_color'])}**. Il colore dovrà essere "
          "confermato da fonte ufficiale in `data/lines.json`.")
    for d in t["duplicate_colors"]:
        a(f"- ⚠️ Colore `{d['color']}` condiviso dalle linee {', '.join(d['lines'])}: "
          "ambiguo sulla mappa, da disambiguare.")

    gaps = [(l["id"], g) for l in t["lines"] for g in l["internal_gaps"]]
    a("\n### 3.2 Discontinuità interne alle linee\n")
    if gaps:
        a("| Linea | Tronconi | Distanza | Entro tolleranza snap |")
        a("|---|---|---|---|")
        for lid, g in sorted(gaps, key=lambda x: x[1]["distance_m"]):
            a(f"| {lid} | {g['between_parts'][0]}–{g['between_parts'][1]} | "
              f"{g['distance_m']} m | {'sì' if g['within_snap_tolerance'] else 'no'} |")
    else:
        a("- Nessuna discontinuità interna: ogni linea è un tratto continuo.")

    a("\n### 3.3 Intersezioni e interscambi fra linee\n")
    a(f"Tolleranza di snapping: `TOPOLOGY_SNAP_TOLERANCE_METERS = {t['snap_tolerance_m']} m` "
      "(parametro configurabile, non un dato rilevato).\n")
    if t["intersections"]:
        a(f"Rilevate **{len(t['intersections'])}** coppie di linee in contatto:\n")
        a("| Linee | Tipo | Distanza | Punto (lon, lat) |")
        a("|---|---|---|---|")
        for i in t["intersections"]:
            a(f"| {i['lines'][0]} ↔ {i['lines'][1]} | {i['type']} | {i['distance_m']} m | "
              f"{i['point_wgs84'][0]}, {i['point_wgs84'][1]} |")
    else:
        a("- Nessuna intersezione rilevata: le linee non si toccano.")

    a("\n### 3.4 Connettività della rete\n")
    a("Analisi svolta **sui soli estremi** dei tronconi: due linee che si toccano a metà "
      "percorso (attraversamento) risultano qui separate. La nodalizzazione dei punti di "
      "attraversamento avviene nella costruzione del grafo di routing "
      "(`build-routing-graph.py`), che spezza gli archi in corrispondenza delle "
      "intersezioni elencate al §3.3.\n")
    a(f"- Tronconi (archi a livello di linea): **{t['network_edges_approx']}**")
    a(f"- Nodi terminali distinti (dopo snap a {t['snap_tolerance_m']} m): "
      f"**{t['network_nodes_approx']}**")
    a(f"- Componenti connesse considerando i soli estremi: "
      f"**{t['endpoint_connected_components']}** (dimensioni: "
      f"{t['endpoint_component_sizes']})")
    a(f"- Coppie di linee in contatto per attraversamento o prossimità: "
      f"**{len(t['intersections'])}** (§3.3) — sono questi i punti che rendono la rete "
      "percorribile come grafo unico.")

    a("\n## 4. Rete stradale di supporto (routing)\n")
    r = v.get("road_network", {})
    if r:
        a(f"- Archi: **{r['edges']}** — lunghezza totale **{r['length_km']} km** — "
          f"archi con nome: **{r['named_edges']}**")
        a("\n| Tag `highway` | Archi |")
        a("|---|---|")
        for k, n in r["highway"].items():
            a(f"| `{k}` | {n} |")
        a("\nTag rilevanti per la ciclabilità effettivamente presenti nel dataset:\n")
        for k, vals in r["cycling_tags"].items():
            a(f"- `{k}`: " + ", ".join(f"{a_}={b_}" for a_, b_ in vals.items()))

    a("\n## 5. Punti di interesse\n")
    for key, cat in v["poi_categories"].items():
        a(f"\n### {key}\n")
        for field, vals in cat.items():
            a(f"- `{field}`: " + ", ".join(f"**{a_}** ({b_})" for a_, b_ in vals.items()))

    a("\n## 6. Esito\n")
    if v["blocking_issues"]:
        a("**❌ VALIDAZIONE NON SUPERATA** — problemi bloccanti:\n")
        for b in v["blocking_issues"]:
            a(f"- {b}")
    else:
        a("**✅ VALIDAZIONE SUPERATA** — è possibile procedere alla costruzione del "
          "grafo di routing.\n")
    if v["warnings"]:
        a("\nAvvertenze non bloccanti:\n")
        for w in v["warnings"]:
            a(f"- ⚠️ {w}")

    out.write_text("\n".join(L) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------
def main() -> int:
    symbology = extract_qgis_symbology(QGZ)

    layers, frames = [], {}
    for key, (path, layer) in SOURCES.items():
        res, metric = analyse_layer(key, path, layer)
        layers.append(res)
        frames[key] = metric

    topo = analyse_bicipolitana(frames["linee"], symbology)

    roads = frames["strade"]
    cycling_tags = {}
    for col in ("bicycle", "cycleway", "cycleway:both", "cycleway:left",
                "cycleway:right", "surface", "maxspeed", "oneway", "access",
                "segregated", "lit", "smoothness"):
        if col in roads.columns and roads[col].notna().any():
            cycling_tags[col] = {
                str(k): int(n) for k, n in roads[col].value_counts().head(12).items()
            }
    road_network = {
        "edges": int(len(roads)),
        "length_km": round(float(roads.length.sum()) / 1000, 1),
        "highway": {str(k): int(n) for k, n in roads["highway"].value_counts().items()},
        "named_edges": int(roads["name"].notna().sum()),
        "cycling_tags": cycling_tags,
    }

    poi_fields = (
        ("servizi", ["amenity", "shop", "man_made", "bicycle_parking", "bicycle_rental",
                     "service:bicycle:repair", "service:bicycle:pump", "access", "fee"]),
        ("ostacoli", ["barrier", "cycle_barrier", "bicycle", "foot", "access",
                      "maxwidth", "locked"]),
        ("svago", ["leisure", "tourism", "amenity", "man_made"]),
    )
    poi_categories = {}
    for key, fields in poi_fields:
        g = frames[key]
        poi_categories[key] = {
            f: {str(k): int(n) for k, n in g[f].value_counts().items()}
            for f in fields if f in g.columns and g[f].notna().any()
        }

    blocking: list[str] = []
    warnings: list[str] = []
    for ly in layers:
        if ly["invalid_geometries"]:
            blocking.append(
                f"Layer `{ly['layer']}`: {len(ly['invalid_geometries'])} geometrie non valide.")
        if ly["null_geometries"] or ly["empty_geometries"]:
            warnings.append(
                f"Layer `{ly['layer']}`: {len(ly['null_geometries'])} geometrie nulle e "
                f"{len(ly['empty_geometries'])} vuote — escluse dalle elaborazioni.")
        if not ly["crs_matches_project"]:
            warnings.append(
                f"Layer `{ly['layer']}`: CRS {ly['crs_declared']} diverso dal CRS di "
                f"progetto {CRS_SOURCE} — riproiettato in fase di analisi.")
        if ly["exact_duplicate_geometries"]:
            warnings.append(
                f"Layer `{ly['layer']}`: {len(ly['exact_duplicate_geometries'])} "
                "geometrie duplicate esatte.")
    if topo["lines_without_qgis_color"]:
        warnings.append("Linee prive di colore nella simbologia QGIS: "
                        + ", ".join(topo["lines_without_qgis_color"]))
    for d in topo["duplicate_colors"]:
        warnings.append(f"Colore {d['color']} condiviso da linee {', '.join(d['lines'])}.")
    if topo["endpoint_connected_components"] > 1:
        warnings.append(
            f"La rete Bicipolitana ha {topo['endpoint_connected_components']} componenti "
            "non connesse a livello di estremi; la connessione effettiva passa dai "
            f"{len(topo['intersections'])} attraversamenti fra linee, nodalizzati nel grafo "
            "di routing.")

    validation = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "project": "Bicipolitana Pesaro",
        "source_project": QGZ.name,
        "crs_source": CRS_SOURCE,
        "crs_web": CRS_WEB,
        "layers": layers,
        "qgis_symbology": symbology,
        "bicipolitana_topology": topo,
        "road_network": road_network,
        "poi_categories": poi_categories,
        "blocking_issues": blocking,
        "warnings": warnings,
        "passed": not blocking,
    }

    (METADATA / "validation.json").write_text(
        json.dumps(validation, indent=2, ensure_ascii=False), encoding="utf-8")
    write_markdown(validation, DOCS / "data_audit_report.md")

    print(f"Layer analizzati      : {len(layers)}")
    print(f"Linee Bicipolitana    : {topo['distinct_lines']} -> {', '.join(topo['line_ids'])}")
    print(f"Intersezioni fra linee: {len(topo['intersections'])}")
    print(f"Componenti connesse   : {topo['endpoint_connected_components']} {topo['endpoint_component_sizes']}")
    print(f"Bloccanti: {len(blocking)} | Avvertenze: {len(warnings)}")
    print("-> docs/data_audit_report.md")
    print("-> data/metadata/validation.json")
    return 0 if not blocking else 1


if __name__ == "__main__":
    raise SystemExit(main())
