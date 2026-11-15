"""Fetch and retain monthly GPM IMERG Final district precipitation estimates."""
import argparse
import json
from pathlib import Path

import ee

from dataset import CELLS, REGION_FILE
from hashlib import sha256

ASSET = "NASA/GPM_L3/IMERG_MONTHLY_V07"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    ee.Initialize(project=args.project)
    regions = ee.FeatureCollection([
        ee.Feature(ee.Geometry(geometry, None, False), {"id": cell})
        for cell, geometry in CELLS.items()
    ])
    collection = ee.ImageCollection(ASSET).select("precipitation")
    samples = {cell: {} for cell in CELLS}
    for start in range(2003, 2025, 3):
        end = min(start + 3, 2025)
        images = collection.filterDate(f"{start}-01-01", f"{end}-01-01").sort("system:time_start")
        metadata = images.aggregate_array("system:index").getInfo()
        months = [f"{year}-{month:02}" for year in range(start, end) for month in range(1, 13)]
        if len(metadata) != len(months) or any(
            "".join(c for c in image_id if c.isdigit())[:6] != month.replace("-", "")
            for image_id, month in zip(metadata, months)
        ):
            raise ValueError(f"Unexpected precipitation image dates for {start}–{end - 1}")
        projection = ee.Image(images.first()).projection()
        area = ee.Image.pixelArea()
        def bands(image):
            rate = ee.Image(image)
            hours = rate.date().advance(1, "month").difference(rate.date(), "hour")
            return rate.multiply(hours).multiply(area).rename("weighted").addBands(
                area.updateMask(rate.mask()).rename("area")
            ).copyProperties(image, ["system:index"])
        reduced = images.map(bands).toBands().reduceRegions(
            collection=regions, reducer=ee.Reducer.sum(), crs=projection,
        ).map(lambda feature: ee.Feature(None, feature.toDictionary()))
        response = ee.data.computeFeatures({"expression": reduced})
        if response.get("nextPageToken") or {f["properties"]["id"] for f in response["features"]} != set(CELLS):
            raise ValueError(f"Unexpected district coverage for {start}–{end - 1}")
        for feature in response["features"]:
            values = feature["properties"]
            for image, month in zip(metadata, months):
                land_area = values.get(f"{image}_area")
                if land_area:
                    samples[values["id"]][month] = [values[f"{image}_weighted"] / land_area, f"{ASSET}/{image}"]
        print(start, end - 1, flush=True)
    output = {"asset": ASSET, "boundary_sha256": sha256(REGION_FILE.read_bytes()).hexdigest(),
              "units": "mm per month", "districts": samples}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(output, indent=2), encoding="utf-8")
    temporary.replace(args.output)


if __name__ == "__main__":
    main()
