"""Urban Heat analysis of the versioned Terra MODIS and land-cover extracts."""
from hashlib import sha256
import json
import math

from analysis import compare, estimate
from dataset import CELLS, REGION_FILE

LST_ASSET = "MODIS/061/MOD11A2"
COVER_ASSET = "MODIS/061/MCD12Q1"


def analyze_heat(data_dir, pair, start, end, pass_name, observations):
    path = data_dir / "heat.json"
    if not path.is_file():
        return None
    bundle = json.loads(path.read_text(encoding="utf-8"))
    dates = {f"{year}-{month:02}": (year - 2003) * 12 + month - 1
             for year in range(start, end + 1) for month in range(1, 13)}
    if (bundle["asset"] != LST_ASSET or bundle["land_cover_asset"] != COVER_ASSET
            or bundle["boundary_sha256"] != sha256(REGION_FILE.read_bytes()).hexdigest()
            or any(not bundle["source_images"].get(date)
                   or any(not image.startswith(LST_ASSET + "/") for image in bundle["source_images"][date])
                   for date in dates)):
        raise ValueError("Urban Heat archive does not match the source or study period")
    first, last = (start - 2003) * 12, (end - 2002) * 12
    raw = {cell: {date: row for date, row in bundle["districts"][cell].items() if date in dates}
           for cell in CELLS}
    sources = {date: bundle["source_images"][date] for date in dates}
    for cell, records in raw.items():
        for date, row in records.items():
            for value in row.values():
                if not (math.isfinite(value["value"]) and -100 <= value["value"] <= 90
                        and 0 < value["area_fraction"] <= 1.00001
                        and 0 < value["composites"] <= len(sources[date])):
                    raise ValueError(f"Invalid MODIS coverage or temperature for {cell} {date}")

    def series(cell, field):
        return {dates[date]: row[field]["value"] for date, row in raw[cell].items() if field in row}

    def paired(left, right, left_name, right_name):
        data = {("lst", left_name, "standard"): left, ("lst", right_name, "standard"): right}
        return compare(data, (left_name, right_name), "lst", "standard", first, last)

    district = {}
    paired_heat = {}
    for overpass in ("day", "night"):
        field = overpass + "_district"
        district[overpass] = paired(series(pair[0], field), series(pair[1], field), *pair)
        paired_heat[overpass] = {
            cell: paired(series(cell, overpass + "_urban"), series(cell, overpass + "_reference"), "urban", "reference")
            for cell in pair
        }
    day_night = {
        cell: paired(series(cell, "day_district"), series(cell, "night_district"), "day", "night")
        for cell in pair
    }
    land = {}
    ndvi, manifest = observations
    for cell in pair:
        annual = []
        vegetation = ndvi.get(("terra", cell, "standard"), {})
        for year in range(start, min(end, 2023) + 1):
            key = str(year)
            cover = bundle["growth"][cell].get(key)
            months = [vegetation[t] for t in range((year - 2003) * 12, (year - 2002) * 12) if t in vegetation]
            annual.append({"year": year, "classified_area": cover, "image_id": bundle["growth_image_ids"].get(key),
                           "ndvi": sum(months) / 12 if len(months) == 12 else None,
                           "ndvi_months": len(months)})
        land[cell] = {"annual": annual, "greenness_trend": estimate(
            {t: value for t, value in vegetation.items() if first <= t < last}, last - first)}
    return {
        "request": {"pair": pair, "start": start, "end": end, "overpass": pass_name},
        "assets": [LST_ASSET, COVER_ASSET], "boundary_sha256": bundle["boundary_sha256"],
        "method": bundle["method"], "source_images": sources,
        "reference_area_m2": {cell: bundle["reference_area_m2"][cell] for cell in pair},
        "coverage": {cell: raw[cell] for cell in pair},
        "district": district, "day_night": day_night, "urban": paired_heat, "land": land, "ndvi_source": manifest,
        "map": {cell: estimate(series(cell, pass_name + "_district"), last - first) for cell in CELLS},
    }
