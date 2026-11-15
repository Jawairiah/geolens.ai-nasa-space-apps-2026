"""Extract monthly district averages from quality-screened NASA SMAP AM retrievals."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
from datetime import datetime, timezone

import ee

from dataset import CELLS, REGION_FILE

ASSET = "NASA/SMAP/SPL3SMP_E/006"
BAND = "soil_moisture_am"


def run(project: str, output: Path) -> None:
    """Extract available complete calendar years ending with the pilot archive."""
    ee.Initialize(project=project)
    source = ee.ImageCollection(ASSET)
    projection = ee.Image(source.first()).select(BAND).projection()
    regions = ee.FeatureCollection([
        ee.Feature(ee.Geometry(geom, None, False), {"district": district})
        for district, geom in CELLS.items()
    ])
    area = ee.Image.pixelArea()
    samples = {district: {} for district in CELLS}
    provenance = {}
    for year in (2024,):
        for month in range(1, 13):
            key = f"{year}-{month:02}"
            start = ee.Date(key + "-01")
            dates = source.filterDate(start, start.advance(1, "month"))
            image_ids = dates.aggregate_array("system:index").getInfo()
            provenance[key] = [f"{ASSET}/{image_id}" for image_id in image_ids]
            if not image_ids:
                continue

            def usable(image):
                moisture = image.select(BAND)
                valid = image.select("retrieval_qual_flag_am").eq(0).And(moisture.gte(0)).And(moisture.lte(1))
                return moisture.updateMask(valid)

            observations = dates.map(usable)
            count = observations.count()
            mean = observations.mean().updateMask(count.gte(5))
            valid_area = area.updateMask(mean.mask())
            bands = mean.multiply(valid_area).rename("weighted").addBands(valid_area.rename("valid_area"))
            reduced = bands.reduceRegions(regions, ee.Reducer.sum(), crs=projection).map(
                lambda feature: ee.Feature(None, feature.toDictionary())
            )
            features = ee.data.computeFeatures({"expression": reduced})["features"]
            if {item["properties"]["district"] for item in features} != set(CELLS):
                raise ValueError(f"Incomplete district response for {key}")
            for item in features:
                properties = item["properties"]
                valid = properties.get("valid_area")
                if valid:
                    samples[properties["district"]][key] = {
                        "value": properties["weighted"] / valid, "valid_area_m2": valid,
                    }
            print(key, len(image_ids), sum(key in values for values in samples.values()), flush=True)
    data = {"asset": ASSET, "band": BAND, "boundary_sha256": sha256(REGION_FILE.read_bytes()).hexdigest(),
            "units": "m³/m³", "minimum_valid_days_per_pixel": 5, "retrieved_utc": datetime.now(timezone.utc).isoformat(),
            "districts": samples, "source_images": provenance}
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
    temporary.replace(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.project, args.output)
