"""Shared geographic grid and versioned observation loading."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path

REGION_FILE = Path(__file__).with_name("regions.geojson")
REGIONS = json.loads(REGION_FILE.read_text(encoding="utf-8"))
CELLS = {feature["id"]: feature["geometry"] for feature in REGIONS["features"]}
MODIS_ASSETS = ("MODIS/061/MOD13A3", "MODIS/061/MYD13A3")
DATA_UNAVAILABLE = "Satellite observations are unavailable. A source extract must be loaded before analysis."


def load():
    path = os.getenv("OBSERVATIONS_CSV")
    if not path:
        return {}, {"mode": "unavailable", "name": "Satellite observations unavailable"}
    with open(Path(path).with_suffix(".json"), encoding="utf-8") as file:
        manifest = json.load(file)
    content = Path(path).read_bytes()
    if (not isinstance(manifest, dict)
            or manifest.get("version") != hashlib.sha256(content).hexdigest()
            or manifest.get("assets") != list(MODIS_ASSETS)
            or manifest.get("boundaries") != REGIONS["source"]
            or manifest.get("boundary_sha256") != hashlib.sha256(REGION_FILE.read_bytes()).hexdigest()):
        raise ValueError("Observation extract does not match its source manifest")
    data = {}
    with io.StringIO(content.decode("utf-8"), newline="") as file:
        for row in csv.DictReader(file):
            source, cell, quality = (row[key] for key in ("source","cell","quality"))
            year, month = map(int, row["month"].split("-"))
            key = (source,cell,quality)
            if source not in ("terra","aqua") or cell not in CELLS or quality not in ("standard","strict") or not 1<=month<=12:
                raise ValueError("Invalid observation key")
            t = (year-2003)*12 + month-1
            value, coverage = float(row["ndvi"]), float(row["coverage"])
            if not (0<=t<264 and -.2<=value<=1 and 0<=coverage<=1):
                raise ValueError("Invalid observation value")
            records = data.setdefault(key,{})
            if t in records:
                raise ValueError("Duplicate observation")
            records[t] = value
    if not data:
        raise ValueError("Observation extract is empty")
    if manifest.get("accepted") != sum(map(len, data.values())):
        raise ValueError("Observation count does not match the source manifest")
    return data, {**manifest, "mode": "source extract"}
