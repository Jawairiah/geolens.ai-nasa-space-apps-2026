"""Retrieve real district-month MODIS observations on the native pixel grid."""
import argparse
import csv
from pathlib import Path

import ee

from dataset import CELLS, MODIS_ASSETS

PRODUCTS = dict(zip(("terra", "aqua"), MODIS_ASSETS, strict=True))
COLUMNS = ("cell", "month", "source", "quality", "image_id", "weighted", "valid_area", "land_area")


def pixel_inputs(raw: ee.Image, quality: str) -> tuple[ee.Image, ee.Image, ee.Image]:
    """Return scaled NDVI, product land mask and usable land pixels."""
    qa = raw.select("DetailedQA")
    ndvi = raw.select("NDVI")
    land = qa.rightShift(11).bitwiseAnd(7).eq(1)
    summary = raw.select("SummaryQA")
    good = summary.gte(0).And(summary.lte(1 if quality == "standard" else 0))
    good = good.And(ndvi.gte(-2000)).And(ndvi.lte(10000))
    for bit in (8, 10, 14, 15):
        good = good.And(qa.rightShift(bit).bitwiseAnd(1).eq(0))
    if quality == "strict":
        good = good.And(qa.rightShift(6).bitwiseAnd(3).neq(3))
    return ndvi.multiply(0.0001), land, land.And(good)


def monthly_bands(raw: ee.Image) -> ee.Image:
    """Build native-grid measurements for one month and both quality filters."""
    raw = ee.Image(raw)
    ndvi, land, standard = pixel_inputs(raw, "standard")
    _, _, strict = pixel_inputs(raw, "strict")
    area = ee.Image.pixelArea()
    bands = [area.updateMask(land).rename("land_area")]
    for quality, mask in (("standard", standard), ("strict", strict)):
        valid = area.updateMask(mask)
        bands.extend([ndvi.multiply(valid).rename(f"{quality}_weighted"),
                      valid.rename(f"{quality}_valid_area")])
    return ee.Image.cat(bands).set("system:index", raw.get("system:index"))


def fetch_year(source: str, year: int) -> list[dict]:
    """Read one satellite-year of district statistics and check all expected keys."""
    regions = ee.FeatureCollection([
        ee.Feature(ee.Geometry(geometry, None, False), {"cell": cell})
        for cell, geometry in CELLS.items()
    ])
    images = ee.ImageCollection(PRODUCTS[source]).filterDate(
        f"{year}-01-01", f"{year + 1}-01-01",
    ).sort("system:time_start")
    projection = ee.Image(images.first()).select("NDVI").projection()
    stack = images.map(monthly_bands).toBands()
    reduced = stack.reduceRegions(collection=regions, reducer=ee.Reducer.sum(), crs=projection)
    rows = reduced.map(lambda feature: ee.Feature(None, feature.toDictionary()))
    response = ee.data.computeFeatures({"expression": rows, "pageSize": 50})
    if response.get("nextPageToken") or len(response["features"]) != len(CELLS):
        raise ValueError(f"Incomplete Earth Engine district results for {source} {year}")
    records = []
    for item in response["features"]:
        props = item["properties"]
        for month in range(1, 13):
            image = f"{year}_{month:02}_01"
            land = props.get(f"{image}_land_area")
            if f"{image}_land_area" not in props:
                raise ValueError(f"Missing land area band for {source} {image}, {props['cell']}")
            for quality in ("standard", "strict"):
                records.append({
                    "cell": props["cell"],
                    "month": f"{year}-{month:02}",
                    "source": source,
                    "quality": quality,
                    "image_id": f"{PRODUCTS[source]}/{image}",
                    "weighted": props.get(f"{image}_{quality}_weighted"),
                    "valid_area": props.get(f"{image}_{quality}_valid_area"),
                    "land_area": land,
                })
    expected = {
        (cell, f"{year}-{month:02}", quality)
        for cell in CELLS for month in range(1, 13) for quality in ("standard", "strict")
    }
    actual = {(row["cell"], row["month"], row["quality"]) for row in records}
    if len(records) != len(expected) or actual != expected:
        raise ValueError(f"Incomplete or duplicate Earth Engine rows for {source} {year}")
    return records


def export_year(output: Path, source: str, year: int) -> None:
    """Save a complete satellite-year atomically, preserving previous successful fetches."""
    destination = output / f"geolens_{source}_{year}.csv"
    if destination.exists():
        print(f"{source} {year}: already downloaded", flush=True)
        return
    records = fetch_year(source, year)
    temporary = destination.with_suffix(".tmp")
    with temporary.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(sorted(records, key=lambda row: (row["quality"], row["month"], row["cell"])))
    temporary.replace(destination)
    print(f"{source} {year}: {len(records)} district-month quality records", flush=True)


def main() -> None:
    """Run the district observation export."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--year", type=int, choices=range(2003, 2025), nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    ee.Initialize(project=args.project)
    args.output.mkdir(parents=True, exist_ok=True)
    for year in args.year:
        for source in PRODUCTS:
            export_year(args.output, source, year)


if __name__ == "__main__":
    main()
