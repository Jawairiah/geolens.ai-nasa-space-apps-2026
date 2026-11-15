"""Validate Earth Engine extracts and write a versioned observation bundle."""
import argparse
import csv
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from dataset import CELLS, MODIS_ASSETS, REGIONS

KEYS = ("source","cell","quality","month")
FIELDS = (*KEYS,"ndvi","coverage")


def prepare(source: Path, output: Path, *, require_complete: bool = False) -> None:
    """Validate original extract rows and record observation and coverage provenance."""
    paths = sorted(source.glob("geolens_*.csv"))
    rows, coverage_rows, seen, image_ids = [], [], set(), set()
    for path in paths:
        with path.open(newline="", encoding="utf-8-sig") as file:
            for row in csv.DictReader(file):
                key = tuple(row[field] for field in KEYS)
                mission, cell, quality, date = key
                year, month = map(int,date.split("-"))
                if key in seen or mission not in ("terra","aqua") or cell not in CELLS or quality not in ("standard","strict") or not (2003 <= year <= 2024 and 1 <= month <= 12):
                    raise ValueError(f"Invalid or duplicate record: {key}")
                seen.add(key)
                image_id = row.get("image_id", "")
                if require_complete:
                    asset = MODIS_ASSETS[("terra", "aqua").index(mission)]
                    if image_id != f"{asset}/{year}_{month:02}_01":
                        raise ValueError(f"Invalid original product image ID: {key}")
                    image_ids.add(image_id)
                valid, land = (float(row[field] or 0) for field in ("valid_area","land_area"))
                if not all(map(math.isfinite,(valid,land))) or min(valid,land)<0 or valid>land+1e-6:
                    raise ValueError(f"Invalid coverage: {key}")
                fraction = min(1,valid/land) if land else 0
                accepted = fraction>=.5
                coverage_rows.append((*key, fraction, accepted, image_id, valid, land))
                if accepted:
                    ndvi = float(row["weighted"])/valid
                    if not -.2<=ndvi<=1:
                        raise ValueError(f"Invalid NDVI: {key}")
                    rows.append((*key,ndvi,fraction))
    expected_count = 2 * 2 * len(CELLS) * 264
    if require_complete and len(seen) != expected_count:
        raise ValueError(f"Incomplete extract: {len(seen)} of {expected_count} expected rows")
    if not rows:
        raise ValueError("No observations cleared the coverage threshold")
    output.parent.mkdir(parents=True,exist_ok=True)
    for path, fields, records in [(output,FIELDS,rows),(output.with_suffix(".coverage.csv"),(*KEYS, "coverage", "accepted", "image_id", "valid_area_m2", "land_area_m2"),coverage_rows)]:
        with path.open("w",newline="",encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(fields)
            writer.writerows(sorted(records))
    version = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".json").write_text(json.dumps({
        "version":version,"name":"NASA Terra and Aqua MODIS v6.1",
        "assets":list(MODIS_ASSETS),"scale_factor":.0001,"boundaries":REGIONS["source"],
        "min_land_coverage":.5,"accepted":len(rows),"observed":len(seen),
        "expected":expected_count,"input_files":[p.name for p in paths],
        "retrieved_utc":datetime.now(timezone.utc).isoformat(),
        "image_ids":sorted(image_ids), "start_month":"2003-01", "end_month":"2024-12",
        "boundary_sha256":hashlib.sha256(Path(__file__).with_name("regions.geojson").read_bytes()).hexdigest(),
        "boundary_note":"Historical six-district OCHA geography; no separate Keamari polygon."
    },indent=2),encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source",type=Path)
    parser.add_argument("output",type=Path)
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    prepare(args.source, args.output, require_complete=args.require_complete)
