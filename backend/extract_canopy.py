"""Build fixed-support district summaries from original NASA MOD44B assets."""
import argparse
from hashlib import sha256
import json
from pathlib import Path

import ee

from dataset import CELLS, REGION_FILE

ASSET = "MODIS/061/MOD44B"
LAND_ASSET = "MODIS/061/MCD12Q1/2003_01_01"
METHOD = ("Area-weighted tree canopy on the native 250 m grid. The 2003 IGBP land mask excludes water. "
          "Retain pixels with canopy in [0,100] in every archive year and require at least half of mapped land. "
          "Report annually the share of those pixels with at least five of eight inputs passing MOD44B Quality flags. "
          "Input quality is reported separately from canopy estimates. Year is the MOD44B image start year.")


def extract(project: str, output: Path) -> None:
    ee.Initialize(project=project)
    collection = ee.ImageCollection(ASSET).filterDate("2003-01-01", "2025-01-01").sort("system:time_start")
    ids = collection.aggregate_array("system:index").getInfo()
    if [int(image[:4]) for image in ids] != list(range(2003, 2025)):
        raise ValueError(f"Unexpected MOD44B archive years: {ids}")
    districts = ee.FeatureCollection([
        ee.Feature(ee.Geometry(geometry, None, False), {"cell": cell}) for cell, geometry in CELLS.items()
    ])
    grid = ee.Image(collection.first()).select("Percent_Tree_Cover").projection()
    landcover = ee.Image(LAND_ASSET).select("LC_Type1")
    land = landcover.gte(1).And(landcover.lte(16))

    def valid(image):
        canopy = image.select("Percent_Tree_Cover")
        return canopy.gte(0).And(canopy.lte(100)).unmask(0).rename("valid")

    def good_inputs(image):
        quality = image.select("Quality")
        bad = quality.bitwiseAnd(1)
        for bit in range(1, 8):
            bad = bad.add(quality.rightShift(bit).bitwiseAnd(1))
        return bad.lte(3).unmask(0)

    common = collection.map(valid).min().And(land)
    area = ee.Image.pixelArea()
    support = area.updateMask(common)
    def annual_bands(image):
        weighted = image.select("Percent_Tree_Cover").multiply(support).rename("weighted")
        clear_support = support.multiply(good_inputs(image)).rename("quality_area")
        return weighted.addBands(clear_support).copyProperties(image, ["system:index"])

    stack = collection.map(annual_bands).toBands()
    summary = stack.addBands([support.rename("support"), area.updateMask(land).rename("land")])
    stats = summary.reduceRegions(districts, ee.Reducer.sum(), crs=grid).map(
        lambda feature: ee.Feature(None, feature.toDictionary())
    )
    response = ee.data.computeFeatures({"expression": stats})
    by_cell = {feature["properties"]["cell"]: feature["properties"] for feature in response["features"]}
    if response.get("nextPageToken") or len(response["features"]) != len(CELLS) or by_cell.keys() != CELLS.keys():
        raise ValueError("Incomplete canopy district response")
    records = {}
    for cell, row in by_cell.items():
        fixed_area = row.get("support") or 0
        mapped_land = row.get("land") or 0
        annual = {}
        quality = {}
        if mapped_land and fixed_area >= mapped_land / 2:
            annual = {image[:4]: row[f"{image}_weighted"] / fixed_area for image in ids}
            quality = {image[:4]: row[f"{image}_quality_area"] / fixed_area for image in ids}
        records[cell] = {"land_area_m2": mapped_land, "support_area_m2": fixed_area,
                         "annual": annual, "quality_share": quality}
    data = {"asset": ASSET, "land_mask_asset": LAND_ASSET, "method": METHOD,
            "boundary_sha256": sha256(REGION_FILE.read_bytes()).hexdigest(),
            "images": {image[:4]: f"{ASSET}/{image}" for image in ids}, "districts": records}
    temp = output.with_suffix(".tmp")
    temp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    temp.replace(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    extract(args.project, args.output)
