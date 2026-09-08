"""
Configurazione condivisa della pipeline GIS -> Web di Bicipolitana Pesaro.

Tutti i parametri "di modello" (tolleranze, velocita', penalita') sono
dichiarati QUI e sono STIME esplicite, non dati misurati sul campo.
Ogni valore stimato viene marcato nei report generati.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
GEOJSON = ROOT / "data" / "geojson"
METADATA = ROOT / "data" / "metadata"
ROUTING = ROOT / "data" / "routing"
PUBLIC_DATA = ROOT / "public" / "data"
DOCS = ROOT / "docs"

for _p in (PROCESSED, GEOJSON, METADATA, ROUTING, DOCS):
    _p.mkdir(parents=True, exist_ok=True)

# --- CRS -------------------------------------------------------------------
CRS_SOURCE = "EPSG:3004"   # Monte Mario / Italy zone 2 (progetto QGIS originale)
CRS_WEB = "EPSG:4326"      # WGS84 lon/lat per il frontend
CRS_METRIC = "EPSG:3004"   # usato per tutte le misure metriche

# --- Sorgenti dati ---------------------------------------------------------
# (file gpkg, nome layer, chiave logica)
SOURCES = {
    "linee":   (RAW / "Linee_bicipolitana.gpkg", "linee_bicipolitana"),
    "servizi": (RAW / "servizi_bicipolitana.gpkg", "servizi_bicipolitana"),
    "ostacoli": (RAW / "Ostacoli.gpkg", "ostacoli_bicipolitana"),
    "svago":   (RAW / "Svago.gpkg", "punti_svago"),
    "strade":  (RAW / "Strade_Pesaro.gpkg", "strade"),
}

QGZ = RAW / "Pesaro2026.qgz"

# --- Parametri topologici (CONFIGURABILI, documentati nel README) ----------
# Distanza massima entro cui due estremita' distinte vengono considerate
# lo stesso nodo. Valore scelto in base alla precisione tipica di una
# digitalizzazione su CTR 1:2000 / ortofoto: NON e' un dato di rilievo.
TOPOLOGY_SNAP_TOLERANCE_METERS = 5.0

# Soglia oltre la quale un "gap" fra due linee viene solo segnalato nel
# report ma NON colmato automaticamente.
TOPOLOGY_GAP_REPORT_METERS = 30.0

# Tolleranza per considerare due geometrie duplicate (Hausdorff).
DUPLICATE_TOLERANCE_METERS = 0.5

# Semplificazione geometrie per il web (Douglas-Peucker, in metri).
SIMPLIFY_TOLERANCE_METERS = 1.0

# --- Parametri di stima (NON dati reali) ----------------------------------
# Velocita' media di crociera in bicicletta urbana. Stima.
DEFAULT_CYCLING_SPEED_KMH = 15.0
ESTIMATE_DISCLAIMER = "stima - non basata su misure di campo"
