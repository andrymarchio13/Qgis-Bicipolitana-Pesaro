#!/usr/bin/env python3
"""
FASE 4 - Metadati finali e pubblicazione dei dati per il frontend.

Ultimo passo della pipeline: raccoglie gli esiti di validazione, conversione e
costruzione del grafo in un unico manifesto, e copia in `public/data/` i soli
file che il browser deve scaricare.

La rete stradale completa (`data/processed/strade_routing.geojson`) NON viene
pubblicata: serve solo alla costruzione del grafo. Nel frontend arriva il
grafo gia' costruito, molto piu' compatto.
"""
from __future__ import annotations

import gzip
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from gis_config import GEOJSON, METADATA, ROOT, ROUTING  # noqa: E402

PUBLIC = ROOT / "public" / "data"

# File pubblicati verso il frontend.
PUBLISHED = [
    (GEOJSON / "linee_bicipolitana.geojson", "linee_bicipolitana.geojson"),
    (GEOJSON / "servizi.geojson", "servizi.geojson"),
    (GEOJSON / "ostacoli.geojson", "ostacoli.geojson"),
    (GEOJSON / "svago.geojson", "svago.geojson"),
    (GEOJSON / "strade.geojson", "strade.geojson"),
    (ROOT / "data" / "lines.json", "lines.json"),
    (ROOT / "data" / "metadata.json", "metadata.json"),
    (ROUTING / "graph.json", "graph.json"),
]

OPTIONAL = [(ROOT / "data" / "incidents.json", "incidents.json")]


def gzip_size(path: Path) -> int:
    """Peso effettivo in rete: GitHub Pages serve i file compressi."""
    return len(gzip.compress(path.read_bytes(), 6))


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)

    missing = [src for src, _ in PUBLISHED if not src.exists()]
    if missing:
        print("File mancanti: esegui prima convert-gpkg.py e build-routing-graph.py")
        for path in missing:
            print(f"  - {path.relative_to(ROOT)}")
        return 1

    published = []
    total_raw = 0
    total_gz = 0
    for src, name in PUBLISHED:
        dst = PUBLIC / name
        shutil.copyfile(src, dst)
        raw = dst.stat().st_size
        gz = gzip_size(dst)
        total_raw += raw
        total_gz += gz
        published.append({"file": name, "bytes": raw, "gzipBytes": gz})
        print(f"  {name:32s} {raw / 1024:8.1f} KB  ->  {gz / 1024:7.1f} KB compresso")

    for src, name in OPTIONAL:
        if src.exists():
            shutil.copyfile(src, PUBLIC / name)
            print(f"  {name:32s} (facoltativo, pubblicato)")

    # Pulizia di eventuali file non piu' previsti.
    expected = {name for _, name in PUBLISHED} | {name for _, name in OPTIONAL}
    for stale in PUBLIC.glob("*"):
        if stale.name not in expected:
            stale.unlink()
            print(f"  rimosso file obsoleto: {stale.name}")

    validation = json.loads((METADATA / "validation.json").read_text(encoding="utf-8"))
    topology = json.loads((ROUTING / "topology_report.json").read_text(encoding="utf-8"))
    conversion = json.loads((ROOT / "data" / "metadata.json").read_text(encoding="utf-8"))

    manifest = {
        "project": "Bicipolitana Pesaro",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pipeline": [
            {"step": "validate-gis.py", "generatedAt": validation["generated_at"],
             "passed": validation["passed"],
             "warnings": len(validation["warnings"]),
             "blocking": len(validation["blocking_issues"])},
            {"step": "convert-gpkg.py", "generatedAt": conversion["generatedAt"],
             "counts": conversion["counts"]},
            {"step": "build-routing-graph.py", "generatedAt": topology["generatedAt"],
             "nodes": topology["graph"]["nodes"], "edges": topology["graph"]["edges"],
             "components": topology["connectivity"]["components"]},
        ],
        "crs": {"original": conversion["crsOriginal"], "web": conversion["webCrs"]},
        "sources": conversion["sources"],
        "attribution": conversion["attribution"],
        "estimates": conversion["estimates"],
        "publishedFiles": published,
        "totalBytes": total_raw,
        "totalGzipBytes": total_gz,
        "notPublished": {
            "data/processed/strade_routing.geojson":
                "rete stradale completa: usata solo per costruire il grafo",
            "data/raw/*.gpkg":
                "dati GIS originali: conservati intatti nel repository, non serviti al browser",
            "RASTER/*.tif":
                "ortofoto e CTR: utili in QGIS, non necessari al frontend",
        },
    }
    (METADATA / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print()
    print(f"  TOTALE pubblicato: {total_raw / 1024:.0f} KB "
          f"({total_gz / 1024:.0f} KB compressi)")
    print("-> public/data/")
    print("-> data/metadata/manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
