"""Extract quality-screened Terra MODIS surface temperatures for Karachi."""
import argparse
from hashlib import sha256
import json
from pathlib import Path

import ee

from dataset import CELLS, REGION_FILE

LST = "MODIS/061/MOD11A2"
COVER = "MODIS/061/MCD12Q1"
METHOD = ("Area-weighted 8-day MOD11A2 composites grouped by start month. "
          "Accept produced pixels (mandatory QA 0 or 1) with good detailed data quality and estimated LST error ≤2 K. "
          "At least 30% of each reference area per composite and half of source composites per month. "
          "Fixed district-local urban and non-built land masks require agreement in 2003, 2013 and 2023; "
          "at least 5 km² of reference area; paired strata share composite dates. Non-built reference includes natural and agricultural land.")


def extract(project, output):
    ee.Initialize(project=project)
    districts = ee.FeatureCollection([
        ee.Feature(ee.Geometry(geometry, None, False), {"cell": cell}) for cell, geometry in CELLS.items()
    ])
    lst = ee.ImageCollection(LST)
    cover = ee.ImageCollection(COVER).select("LC_Type1")
    projection = ee.Image(lst.first()).select("LST_Day_1km").projection()
    class_projection = ee.Image(cover.first()).projection()
    area = ee.Image.pixelArea()
    years = range(2003, 2025)
    classes = {year: ee.Image(cover.filterDate(f"{year}-01-01", f"{year + 1}-01-01").first())
               for year in range(2003, 2024)}
    anchors = [classes[year] for year in (2003, 2013, 2023)]
    urban = anchors[0].eq(13)
    land = anchors[0].gte(1).And(anchors[0].lte(16))
    nonbuilt = land.And(anchors[0].neq(13))
    for anchor in anchors[1:]:
        urban = urban.And(anchor.eq(13))
        nonbuilt = nonbuilt.And(anchor.gte(1)).And(anchor.lte(16)).And(anchor.neq(13))
    masks = {"district": land, "urban": urban, "reference": nonbuilt}

    def rows(image, grid):
        result = image.reduceRegions(districts, ee.Reducer.sum(), crs=grid).map(
            lambda feature: ee.Feature(None, feature.toDictionary())
        )
        page = ee.data.computeFeatures({"expression": result})
        values = {item["properties"]["cell"]: item["properties"] for item in page["features"]}
        if page.get("nextPageToken") or len(page["features"]) != len(CELLS) or values.keys() != CELLS.keys():
            raise ValueError("Unexpected Earth Engine district results")
        return values

    reference = rows(ee.Image.cat([area.updateMask(mask).rename(name) for name, mask in masks.items()]), projection)
    growth = {cell: {} for cell in CELLS}
    growth_images = {str(year): f"{COVER}/{year}_01_01" for year in classes}
    annual_bands = []
    for year, image in classes.items():
        annual_bands += [area.updateMask(image.eq(13)).rename(f"built_{year}"),
                         area.updateMask(image.gte(1).And(image.lte(16))).rename(f"land_{year}")]
    totals = rows(ee.Image.cat(annual_bands), class_projection)
    for cell, values in totals.items():
        for year in classes:
            land_area = values.get(f"land_{year}")
            if land_area:
                growth[cell][str(year)] = {
                    "built_km2": (values.get(f"built_{year}") or 0) / 1e6,
                    "classified_land_km2": land_area / 1e6,
                }
    data = {"asset": LST, "land_cover_asset": COVER, "method": METHOD,
            "boundary_sha256": sha256(REGION_FILE.read_bytes()).hexdigest(),
            "reference_area_m2": {cell: {name: row.get(name) or 0 for name in masks}
                                  for cell, row in reference.items()},
            "source_images": {}, "growth_image_ids": growth_images, "growth": growth,
            "districts": {cell: {} for cell in CELLS}}

    def stack_bands(image):
        image = ee.Image(image)
        bands = []
        for label, suffix in (("day", "Day"), ("night", "Night")):
            qc = image.select(f"QC_{suffix}")
            raw = image.select(f"LST_{suffix}_1km")
            celsius = raw.multiply(0.02).subtract(273.15)
            good = qc.bitwiseAnd(3).lte(1).And(qc.bitwiseAnd(12).eq(0)).And(qc.rightShift(6).lte(1)).And(raw.gte(7500))
            for name, mask in masks.items():
                valid = area.updateMask(mask.And(good)).updateMask(raw.mask())
                bands += [celsius.multiply(valid).rename(f"{label}_{name}_sum"),
                          valid.rename(f"{label}_{name}_area")]
        return ee.Image.cat(bands).set("system:index", image.get("system:index"))

    for year in years:
        for quarter in (1, 7):
            start = f"{year}-{quarter:02}-01"
            stop = f"{year}-07-01" if quarter == 1 else f"{year + 1}-01-01"
            images = lst.filterDate(start, stop).sort("system:time_start")
            metadata = images.aggregate_array("system:index").getInfo()
            totals = rows(images.map(stack_bands).toBands(), projection)
            for month in range(quarter, quarter + 6):
                date = f"{year}-{month:02}"
                ids = [image for image in metadata if image.startswith(date.replace("-", "_"))]
                if not ids:
                    raise ValueError(f"MOD11A2 source month missing: {date}")
                data["source_images"][date] = [f"{LST}/{image}" for image in ids]
                for cell, values in totals.items():
                    monthly = {}
                    bucket = {}
                    for label in ("day", "night"):
                        for name in masks:
                            size = data["reference_area_m2"][cell][name]
                            if size < 5e6:
                                continue
                            key = f"{label}_{name}"
                            good = []
                            for image in ids:
                                valid = values.get(f"{image}_{key}_area") or 0
                                if valid >= size * 0.30:
                                    good.append((values[f"{image}_{key}_sum"] / valid, valid / size, image))
                            bucket[key] = {image: (temp, fraction) for temp, fraction, image in good}
                            if good and len(good) * 2 >= len(ids):
                                monthly[key] = {"value": sum(x[0] for x in good) / len(good),
                                                "composites": len(good), "area_fraction": sum(x[1] for x in good) / len(good)}
                        left = bucket.get(label + "_urban", {})
                        right = bucket.get(label + "_reference", {})
                        common = sorted(left.keys() & right.keys())
                        if common and len(common) * 2 >= len(ids):
                            for name, values_by_image in (("urban", left), ("reference", right)):
                                values_matched = [values_by_image[image] for image in common]
                                monthly[f"{label}_{name}"] = {
                                    "value": sum(x[0] for x in values_matched) / len(common),
                                    "composites": len(common),
                                    "area_fraction": sum(x[1] for x in values_matched) / len(common),
                                    "images": common,
                                }
                        else:
                            monthly.pop(label + "_urban", None)
                            monthly.pop(label + "_reference", None)
                    if monthly:
                        data["districts"][cell][date] = monthly
        print(year, flush=True)
    temp = output.with_suffix(".tmp")
    temp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    temp.replace(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    extract(args.project, args.output)
