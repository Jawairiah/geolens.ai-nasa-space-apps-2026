"""Aggregate original NASA GLDAS Noah 2.1 three-hourly assets over the pilot districts."""
import argparse
from calendar import monthrange
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

import ee

from dataset import CELLS, REGION_FILE

ASSET = "NASA/GLDAS/V021/NOAH/G025/T3H"
SOIL = "SoilMoi0_10cm_inst"
EVAP = "Evap_tavg"
METHOD = "Area-weighted native-grid values. Monthly soil is the mean of 3-hourly snapshots. Monthly ET integrates each 3-hourly mean flux over 10,800 seconds; flux intervals are assigned by their starting timestamp. Every contributing grid cell requires all expected timestamps."


def extract(project: str, output: Path) -> None:
    ee.Initialize(project=project)
    source = ee.ImageCollection(ASSET).select([SOIL, EVAP])
    projection = ee.Image(source.first()).select(SOIL).projection()
    regions = ee.FeatureCollection([ee.Feature(ee.Geometry(geometry, None, False), {"district": cell})
                                    for cell, geometry in CELLS.items()])
    fingerprint = sha256(REGION_FILE.read_bytes()).hexdigest()
    data = {"asset": ASSET, "bands": {"soil": SOIL, "evap": EVAP},
            "boundary_sha256": fingerprint, "method": METHOD, "windows": {},
            "districts": {cell: {} for cell in CELLS}}
    if output.exists():
        saved = json.loads(output.read_text(encoding="utf-8"))
        if any(saved[key] != data[key] for key in ("asset", "bands", "boundary_sha256", "method")):
            raise ValueError("Existing GLDAS output has different provenance")
        data = saved
    for year in range(2003, 2025):
        for first in (1, 4, 7, 10):
            months = range(first, first + 3)
            keys = [f"{year}-{month:02}" for month in months]
            if all(key in data["windows"] for key in keys):
                continue
            stack = []
            for month, key in zip(months, keys):
                start = ee.Date(key + "-01")
                stop = start.advance(1, "month")
                days = monthrange(year, month)[1]
                snapshots = source.filterDate(start, stop)
                flux = source.filterDate(start.advance(3, "hour"), stop.advance(3, "hour"))
                for name, images, band, multiplier, offset in (
                    ("soil", snapshots, SOIL, 1, 0), ("evap", flux, EVAP, days * 86400, 3)
                ):
                    values = images.select(band)
                    timestamps = days * 8
                    mean = values.mean().multiply(multiplier).updateMask(values.count().eq(timestamps))
                    area = ee.Image.pixelArea().updateMask(mean.mask())
                    stack += [mean.multiply(area).rename(f"{name}_{month}"),
                              area.rename(f"{name}_{month}_area")]
                    data["windows"].setdefault(key, {})[name] = {
                        "start_inclusive": (datetime(year, month, 1, hour=offset, tzinfo=timezone.utc)).isoformat(),
                        "end_exclusive": datetime(year + (month == 12), month % 12 + 1, 1, hour=offset, tzinfo=timezone.utc).isoformat(),
                        "required_source_steps_per_pixel": timestamps,
                    }
            returned = ee.Image.cat(stack).reduceRegions(regions, ee.Reducer.sum(), crs=projection).map(
                lambda feature: ee.Feature(None, feature.toDictionary())
            )
            response = ee.data.computeFeatures({"expression": returned})
            features = response["features"]
            if response.get("nextPageToken") or len(features) != len(CELLS) or {f["properties"]["district"] for f in features} != set(CELLS):
                raise ValueError(f"Incomplete district coverage for {keys[0]}")
            for feature in features:
                properties = feature["properties"]
                district = data["districts"][properties["district"]]
                for month, key in zip(months, keys):
                    values = {}
                    for name in ("soil", "evap"):
                        valid = properties.get(f"{name}_{month}_area")
                        if valid:
                            values[name] = {"value": properties[f"{name}_{month}"] / valid, "valid_area_m2": valid}
                    if values:
                        district[key] = values
            data["retrieved_utc"] = datetime.now(timezone.utc).isoformat()
            tmp = output.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
            tmp.replace(output)
            print(keys[-1], flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    extract(args.project, args.output)
