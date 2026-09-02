#!/usr/bin/env python3
"""
FASE 2 - Conversione dei dati GIS originali in dati web.

Legge i GeoPackage in data/raw/ (EPSG:3004, invariati) e produce:

  data/geojson/linee_bicipolitana.geojson
  data/geojson/servizi.geojson
  data/geojson/ostacoli.geojson
  data/geojson/svago.geojson
  data/geojson/strade.geojson        (solo sottoinsieme ciclabile, per debug)
  data/processed/strade_routing.geojson  (rete completa, SOLO per il routing)
  data/lines.json
  data/metadata.json

Regole rispettate:
  - i file originali non vengono mai modificati;
  - nessun attributo viene inventato: se un dato manca resta null e viene
    marcato come non disponibile;
  - i colori delle linee provengono dalla simbologia QGIS; dove assenti si
    usa un colore di ripiego, dichiarato come tale.
"""
from __future__ import annotations

import json
import sys
import warnings as _warnings
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge

sys.path.insert(0, str(Path(__file__).parent))
from gis_config import (  # noqa: E402
    CRS_METRIC, CRS_SOURCE, CRS_WEB, DEFAULT_CYCLING_SPEED_KMH, GEOJSON,
    METADATA, PROCESSED, PUBLIC_DATA, QGZ, ROOT, SIMPLIFY_TOLERANCE_METERS,
    SOURCES,
)

_warnings.filterwarnings("ignore", "GeoSeries.notna", UserWarning)

# validate-gis.py ha un trattino nel nome: va caricato esplicitamente
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "validate_gis", Path(__file__).parent / "validate-gis.py")
_vg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_vg)

explode_lines = _vg.explode_lines
merged_parts_of = _vg.merged_parts_of
extract_qgis_symbology = _vg.extract_qgis_symbology
qgis_color_to_hex = _vg.qgis_color_to_hex


# --------------------------------------------------------------------------
# Colori di ripiego (usati SOLO dove la simbologia QGIS non definisce nulla)
# --------------------------------------------------------------------------
FALLBACK_COLORS = ["#00a0b0", "#7b5ea7", "#b07d00", "#0f766e"]

STATUS_UNKNOWN = "unknown"  # il dataset non contiene un campo di stato


# --------------------------------------------------------------------------
# Classificazione POI: mappature esplicite da tag OSM -> categoria applicativa
# Ogni voce e' derivata dai valori realmente presenti nei dati (cfr. audit).
# --------------------------------------------------------------------------
def classify_servizio(p: dict) -> tuple[str, str]:
    """Ritorna (categoria, etichetta italiana)."""
    amenity = p.get("amenity")
    shop = p.get("shop")
    man_made = p.get("man_made")
    if amenity == "drinking_water" or man_made == "water_tap":
        return "fontanella", "Fontanella"
    if amenity == "bicycle_parking":
        return "parcheggio_bici", "Parcheggio bici"
    if amenity == "bicycle_rental":
        return "noleggio", "Noleggio bici"
    if shop == "bicycle":
        if p.get("service:bicycle:repair") == "yes":
            return "officina", "Officina / riparazione"
        return "negozio_bici", "Negozio di biciclette"
    return "altro_servizio", "Altro servizio"


def classify_ostacolo(p: dict) -> tuple[str, str]:
    barrier = p.get("barrier")
    sub = p.get("cycle_barrier")
    btype = p.get("barrier:type")
    if barrier == "cycle_barrier":
        if btype == "chicane":
            return "chicane", "Chicane"
        if sub == "double":
            return "barriera_doppia", "Barriera doppia"
        if sub == "triple":
            return "barriera_tripla", "Barriera tripla"
        return "barriera_ciclabile", "Barriera ciclabile"
    if barrier:
        return "altra_barriera", f"Barriera ({barrier})"
    return "ostacolo_generico", "Ostacolo"


def classify_svago(p: dict) -> tuple[str, str]:
    if p.get("leisure") == "park":
        return "parco", "Parco"
    if p.get("tourism") == "viewpoint":
        return "belvedere", "Belvedere"
    if p.get("tourism") == "picnic_site":
        return "area_picnic", "Area picnic"
    if p.get("amenity") == "bench":
        return "panchina", "Panchina"
    if p.get("man_made") == "optical_viewer":
        return "binocolo", "Binocolo panoramico"
    return "altro_svago", "Altro punto di interesse"


def bicycle_access_label(value: str | None) -> str:
    return {
        "yes": "Transito consentito",
        "no": "Transito vietato",
        "dismount": "Obbligo di scendere dalla bici",
        "permissive": "Transito tollerato",
        "dismount;yes": "Obbligo di scendere dalla bici",
    }.get(value, "Informazione non disponibile")


# --------------------------------------------------------------------------
def clean_props(row: dict, geom_col: str) -> dict:
    """Rimuove chiavi vuote e la geometria; nessun valore inventato."""
    out = {}
    for k, v in row.items():
        if k == geom_col or v is None:
            continue
        if isinstance(v, float) and v != v:  # NaN
            continue
        s = str(v).strip()
        if s == "" or s.lower() == "nan":
            continue
        out[k] = s
    return out


def to_web(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return gdf.to_crs(CRS_WEB)


def round_geojson(obj, ndigits: int = 6):
    """Arrotonda le coordinate per ridurre il peso del file."""
    if isinstance(obj, float):
        return round(obj, ndigits)
    if isinstance(obj, list):
        return [round_geojson(x, ndigits) for x in obj]
    if isinstance(obj, dict):
        return {k: (round_geojson(v, ndigits) if k in ("coordinates", "bbox")
                    else round_geojson(v, ndigits) if isinstance(v, (list, dict, float))
                    else v)
                for k, v in obj.items()}
    return obj


def write_geojson(features: list[dict], path: Path, extra: dict | None = None) -> int:
    fc = {"type": "FeatureCollection", "features": features}
    if extra:
        fc.update(extra)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(round_geojson(fc), ensure_ascii=False,
                              separators=(",", ":")), encoding="utf-8")
    return path.stat().st_size


# --------------------------------------------------------------------------
# Linee
# --------------------------------------------------------------------------
def build_lines(symbology: dict):
    path, layer = SOURCES["linee"]
    gdf = gpd.read_file(path, layer=layer).to_crs(CRS_METRIC)

    sym = symbology["layers"].get("Linee_Bicipolitana", {})
    cats = sym.get("categories", {})
    colors = sym.get("symbol_colors", {})
    qgis_color = {v: qgis_color_to_hex(colors.get(c["symbol"]))
                  for v, c in cats.items()}

    grouped: dict[str, list[LineString]] = {}
    excluded: list[dict] = []
    for idx, row in gdf.iterrows():
        key = None if row["Nome_Linea"] is None else str(row["Nome_Linea"]).strip()
        parts = explode_lines(row.geometry)
        if not key:
            excluded.append({"feature": int(idx), "reason": "Nome_Linea mancante"})
            continue
        if not parts:
            excluded.append({"feature": int(idx), "line": key,
                             "reason": "geometria vuota"})
            continue
        grouped.setdefault(key, []).extend(parts)

    def sort_key(k: str):
        return (0, int(k), "") if k.isdigit() else (1, 0, k)

    used_colors = {c for c in qgis_color.values() if c}
    fallback_iter = iter([c for c in FALLBACK_COLORS if c not in used_colors])

    lines_meta: list[dict] = []
    features: list[dict] = []

    for key in sorted(grouped, key=sort_key):
        parts = merged_parts_of(grouped[key])
        length_m = sum(p.length for p in parts)

        color = qgis_color.get(key)
        if color:
            color_source = "simbologia QGIS (Pesaro2026.qgz)"
            needs_confirm = False
        else:
            color = next(fallback_iter, "#6b7280")
            color_source = "colore di ripiego generato - da confermare con fonte ufficiale"
            needs_confirm = True

        conflicts = [o for o, c in qgis_color.items()
                     if c and c == qgis_color.get(key) and o != key]

        geom_web = gpd.GeoSeries(
            [MultiLineString(parts) if len(parts) > 1 else parts[0]],
            crs=CRS_METRIC,
        ).simplify(SIMPLIFY_TOLERANCE_METERS).to_crs(CRS_WEB).iloc[0]

        endpoints_web = []
        for p in gpd.GeoSeries(parts, crs=CRS_METRIC).to_crs(CRS_WEB):
            c = list(p.coords)
            endpoints_web.append({
                "start": [round(c[0][0], 6), round(c[0][1], 6)],
                "end": [round(c[-1][0], 6), round(c[-1][1], 6)],
            })

        meta = {
            "id": key,
            "name": f"Linea {key}",
            "officialName": None,
            "officialNameSource": "non disponibile nel dataset GIS - da inserire "
                                  "manualmente se confermato da fonte ufficiale",
            "color": color,
            "colorSource": color_source,
            "colorNeedsConfirmation": needs_confirm,
            "colorConflictsWith": conflicts,
            "status": STATUS_UNKNOWN,
            "statusNote": "il dataset non contiene un campo di stato",
            "lengthMeters": round(float(length_m), 1),
            "lengthKm": round(float(length_m) / 1000, 2),
            "segments": len(parts),
            "contiguous": len(parts) == 1,
            "endpoints": endpoints_web,
            "estimatedMinutes": round(
                (length_m / 1000) / DEFAULT_CYCLING_SPEED_KMH * 60, 1),
            "estimatedMinutesNote": f"stima a {DEFAULT_CYCLING_SPEED_KMH} km/h",
        }
        lines_meta.append(meta)

        features.append({
            "type": "Feature",
            "id": f"line-{key}",
            "properties": {
                "lineId": key,
                "name": meta["name"],
                "color": color,
                "lengthKm": meta["lengthKm"],
                "segments": len(parts),
                "status": STATUS_UNKNOWN,
            },
            "geometry": json.loads(gpd.GeoSeries([geom_web], crs=CRS_WEB).to_json())
                            ["features"][0]["geometry"],
        })

    return lines_meta, features, excluded


# --------------------------------------------------------------------------
# POI
# --------------------------------------------------------------------------
def build_points(key: str, classifier, id_prefix: str):
    path, layer = SOURCES[key]
    gdf = gpd.read_file(path, layer=layer)
    gdf = gdf[~gdf.geometry.isna() & ~gdf.geometry.is_empty]
    gdf = to_web(gdf)
    geom_col = gdf.geometry.name

    features = []
    counts: dict[str, int] = {}
    for i, (_, row) in enumerate(gdf.iterrows()):
        raw = clean_props(row.to_dict(), geom_col)
        cat, label = classifier(raw)
        counts[cat] = counts.get(cat, 0) + 1
        props = {
            "id": f"{id_prefix}-{i}",
            "category": cat,
            "categoryLabel": label,
            "name": raw.get("name"),
            "osmId": raw.get("osm_id"),
            "tags": raw,
        }
        if key == "ostacoli":
            props["bicycleAccess"] = raw.get("bicycle")
            props["bicycleAccessLabel"] = bicycle_access_label(raw.get("bicycle"))
            props["maxWidthMeters"] = raw.get("maxwidth")
        features.append({
            "type": "Feature",
            "id": props["id"],
            "properties": props,
            "geometry": {"type": "Point",
                         "coordinates": [round(row.geometry.x, 6),
                                         round(row.geometry.y, 6)]},
        })
    return features, counts


# --------------------------------------------------------------------------
# Rete stradale
# --------------------------------------------------------------------------
CYCLE_HIGHWAYS = {"cycleway", "path", "footway", "track", "living_street",
                  "pedestrian", "residential", "unclassified", "service",
                  "tertiary", "secondary", "primary", "secondary_link",
                  "tertiary_link", "primary_link", "road", "services"}

ROUTING_FIELDS = ["highway", "name", "bicycle", "cycleway", "cycleway:both",
                  "cycleway:left", "cycleway:right", "surface", "smoothness",
                  "maxspeed", "oneway", "oneway:bicycle", "access", "segregated",
                  "lit", "width", "tracktype", "foot", "service", "incline",
                  "osm_id"]


def build_roads():
    path, layer = SOURCES["strade"]
    gdf = gpd.read_file(path, layer=layer)
    gdf = gdf[~gdf.geometry.isna() & ~gdf.geometry.is_empty]
    keep = [c for c in ROUTING_FIELDS if c in gdf.columns]
    metric = gdf.to_crs(CRS_METRIC)
    simplified = metric.copy()
    simplified["geometry"] = metric.geometry.simplify(SIMPLIFY_TOLERANCE_METERS)
    web = simplified.to_crs(CRS_WEB)

    routing_features = []
    for i, (_, row) in enumerate(web.iterrows()):
        props = {"id": f"road-{i}"}
        for c in keep:
            v = row[c]
            if v is None or (isinstance(v, float) and v != v):
                continue
            s = str(v).strip()
            if s and s.lower() != "nan":
                props[c] = s
        routing_features.append({
            "type": "Feature",
            "id": props["id"],
            "properties": props,
            "geometry": {"type": "LineString",
                         "coordinates": [[round(x, 6), round(y, 6)]
                                         for x, y, *_ in row.geometry.coords]},
        })

    # sottoinsieme "chiaramente ciclabile" per eventuale visualizzazione
    def is_cycle(p: dict) -> bool:
        return (p.get("highway") == "cycleway"
                or p.get("bicycle") in ("designated", "yes")
                or p.get("cycleway") in ("lane", "track", "opposite_lane")
                or p.get("cycleway:both") in ("lane", "track")
                or p.get("cycleway:left") in ("lane", "track")
                or p.get("cycleway:right") in ("lane", "track"))

    cycle_features = [f for f in routing_features if is_cycle(f["properties"])]
    return routing_features, cycle_features


# --------------------------------------------------------------------------
def main() -> int:
    symbology = extract_qgis_symbology(QGZ)

    print("Linee...")
    lines_meta, line_features, excluded = build_lines(symbology)
    size_lines = write_geojson(line_features, GEOJSON / "linee_bicipolitana.geojson")

    print("Servizi...")
    serv_f, serv_c = build_points("servizi", classify_servizio, "srv")
    size_serv = write_geojson(serv_f, GEOJSON / "servizi.geojson")

    print("Ostacoli...")
    ost_f, ost_c = build_points("ostacoli", classify_ostacolo, "obs")
    size_ost = write_geojson(ost_f, GEOJSON / "ostacoli.geojson")

    print("Svago...")
    svg_f, svg_c = build_points("svago", classify_svago, "svg")
    size_svg = write_geojson(svg_f, GEOJSON / "svago.geojson")

    print("Strade...")
    road_f, cycle_f = build_roads()
    size_routing = write_geojson(road_f, PROCESSED / "strade_routing.geojson")
    size_cycle = write_geojson(cycle_f, GEOJSON / "strade.geojson")

    (ROOT / "data" / "lines.json").write_text(
        json.dumps({
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "note": "Generato da scripts/convert-gpkg.py. I campi officialName e "
                    "status non esistono nel dataset GIS: vanno compilati solo su "
                    "fonte ufficiale verificabile.",
            "lines": lines_meta,
        }, indent=2, ensure_ascii=False), encoding="utf-8")

    metadata = {
        "project": "Bicipolitana Pesaro",
        "source": "QGIS project Pesaro2026",
        "sourceFiles": [p.name for p, _ in SOURCES.values()],
        "crsOriginal": CRS_SOURCE,
        "webCrs": CRS_WEB,
        "metricCrs": CRS_METRIC,
        "simplifyToleranceMeters": SIMPLIFY_TOLERANCE_METERS,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": [
            "Comune di Pesaro (rete Bicipolitana digitalizzata nel progetto QGIS)",
            "OpenStreetMap contributors (rete stradale, servizi, ostacoli, punti di svago)",
            "Regione Marche (ortofoto/CTR di supporto alla digitalizzazione)",
        ],
        "attribution": "© OpenStreetMap contributors",
        "counts": {
            "lines": len(lines_meta),
            "lineFeatures": len(line_features),
            "servizi": len(serv_f),
            "ostacoli": len(ost_f),
            "svago": len(svg_f),
            "stradeRouting": len(road_f),
            "stradeCiclabiliVisualizzate": len(cycle_f),
        },
        "categories": {"servizi": serv_c, "ostacoli": ost_c, "svago": svg_c},
        "excludedFeatures": excluded,
        "fileSizesBytes": {
            "linee_bicipolitana.geojson": size_lines,
            "servizi.geojson": size_serv,
            "ostacoli.geojson": size_ost,
            "svago.geojson": size_svg,
            "strade.geojson": size_cycle,
            "processed/strade_routing.geojson": size_routing,
        },
        "estimates": {
            "cyclingSpeedKmh": DEFAULT_CYCLING_SPEED_KMH,
            "note": "I tempi mostrati nell'app sono stime basate su una velocita' "
                    "media costante, non su misure di percorrenza reali.",
        },
    }
    (ROOT / "data" / "metadata.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    (METADATA / "conversion.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")

    print()
    for k, v in metadata["counts"].items():
        print(f"  {k:32s} {v}")
    print()
    for k, v in metadata["fileSizesBytes"].items():
        print(f"  {k:38s} {v / 1024:8.1f} KB")
    print("\n-> data/geojson/  data/lines.json  data/metadata.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
