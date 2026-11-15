"""Annual fixed-support canopy and classified cover context for the forest lens."""
from hashlib import sha256
import json
import math

from analysis import estimate
from dataset import REGION_FILE

ASSET = "MODIS/061/MOD44B"
MASK = "MODIS/061/MCD12Q1/2003_01_01"


def forest_context(data_dir, pair, start, end):
    path = data_dir / "canopy.json"
    if not path.is_file():
        return None
    canopy = json.loads(path.read_text(encoding="utf-8"))
    boundary = sha256(REGION_FILE.read_bytes()).hexdigest()
    years = [str(year) for year in range(start, end + 1)]
    if (canopy["asset"] != ASSET or canopy["land_mask_asset"] != MASK or canopy["boundary_sha256"] != boundary
            or any(not canopy["images"].get(year, "").startswith(f"{ASSET}/{year}_") for year in years)):
        raise ValueError("Canopy archive provenance or year mismatch")
    cover_path = data_dir / "heat.json"
    cover = json.loads(cover_path.read_text(encoding="utf-8")) if cover_path.is_file() else {}
    if cover and (cover["boundary_sha256"] != boundary or cover["land_cover_asset"] != "MODIS/061/MCD12Q1"):
        raise ValueError("Land-cover archive provenance mismatch")
    districts = {}
    for cell in pair:
        record = canopy["districts"][cell]
        land, support = record["land_area_m2"], record["support_area_m2"]
        if not (math.isfinite(land) and math.isfinite(support) and 0 <= support <= land + 1):
            raise ValueError("Invalid canopy support area")
        annual = {int(year): record["annual"][year] for year in years if year in record["annual"]}
        if any(not 0 <= value <= 100 for value in annual.values()) or (annual and support < land / 2):
            raise ValueError("Invalid annual canopy record")
        quality = {year: record["quality_share"][str(year)] for year in annual}
        if any(not 0 <= share <= 1.00001 for share in quality.values()):
            raise ValueError("Invalid MOD44B quality coverage")
        trend = estimate(annual, end - start + 1, periods_per_year=1, min_observations=8, max_lag=2)
        trend["years"] = trend.pop("months")
        baseline, latest = annual.get(start), annual.get(end)
        context = cover.get("growth", {}).get(cell, {}).get("2023")
        districts[cell] = {"annual": annual, "quality_share": quality, "trend": trend, "land_area_m2": land, "support_area_m2": support,
                           "endpoint_change": latest - baseline if start != end and baseline is not None and latest is not None else None,
                           "land_cover_2023": context}
    return {"request": {"pair": pair, "start": start, "end": end}, "asset": ASSET, "land_mask_asset": MASK,
            "boundary_sha256": boundary, "method": canopy["method"],
            "image_ids": {year: canopy["images"][year] for year in years}, "districts": districts,
            "cover_snapshot": cover.get("growth_image_ids", {}).get("2023"),
            "trend_method": "Annual linear regression with two-year Bartlett HAC and approximate 95% intervals."}
