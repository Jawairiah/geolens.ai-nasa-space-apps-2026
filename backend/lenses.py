"""Product definitions for the three GeoLens investigation lenses."""

LENSES = (
    {
        "id": "water-drought",
        "name": "Water & Drought Intelligence",
        "question": "Is your region running drier?",
        "investigations": (
            "Is rainfall changing over time?",
            "Is soil moisture declining while rainfall stays stable?",
            "How unusual was a season relative to its historical baseline?",
        ),
        "core_variables": (
            {"name": "Precipitation", "product": "GPM IMERG Final V07",
             "asset": "NASA/GPM_L3/IMERG_MONTHLY_V07", "kind": "satellite–gauge estimate"},
            {"name": "Modeled soil moisture and evapotranspiration", "product": "GLDAS Noah v2.1",
             "asset": "NASA/GLDAS/V021/NOAH/G025/T3H", "kind": "NASA land-surface model output, 0.25°"},
            {"name": "Surface soil moisture", "product": "NASA SMAP Enhanced L3 v006",
             "asset": "NASA/SMAP/SPL3SMP_E/006", "kind": "satellite AM retrieval, 2024 coverage check"},
        ),
    },
    {
        "id": "urban-heat-growth",
        "name": "Urban Heat & Growth Intelligence",
        "question": "Is your city heating up?",
        "investigations": (
            "Is the urban surface warming faster than a rural reference?",
            "How do daytime and nighttime surface temperature trends differ?",
            "Where do urban expansion and greenness decline coincide?",
        ),
        "core_variables": (
            {"name": "Day and night land surface temperature", "product": "MOD11A2 v6.1",
             "asset": "MODIS/061/MOD11A2", "kind": "satellite-derived surface temperature"},
            {"name": "Land cover", "product": "MCD12Q1 v6.1",
             "asset": "MODIS/061/MCD12Q1", "kind": "satellite-derived classification"},
        ),
    },
    {
        "id": "land-cover-forest",
        "name": "Land Cover & Forest Change Intelligence",
        "question": "What is happening to our land?",
        "investigations": (
            "How has tree-cover percentage changed?",
            "Does the tree-canopy record agree with the greenness trend?",
            "What kinds of land cover are present?",
        ),
        "core_variables": (
            {"name": "Percent tree cover", "product": "MOD44B v6.1",
             "asset": "MODIS/061/MOD44B", "kind": "modeled satellite-derived canopy fraction"},
            {"name": "Land-cover context", "product": "MCD12Q1 v6.1",
             "asset": "MODIS/061/MCD12Q1", "kind": "satellite-derived classification"},
        ),
    },
)

def rainfall_result(data_dir, pair, start, end):
    """Use the shared seasonal paired trend model on original IMERG observations."""
    import json
    import math
    from hashlib import sha256

    from analysis import compare
    from dataset import REGION_FILE

    try:
        bundle = json.loads((data_dir / "rainfall.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    asset = LENSES[0]["core_variables"][0]["asset"]
    if bundle["asset"] != asset or bundle["boundary_sha256"] != sha256(REGION_FILE.read_bytes()).hexdigest():
        raise ValueError("Rainfall bundle source or boundary mismatch")
    source_images = {}
    samples = {}
    for district in pair:
        records = {}
        for date, (value, image) in bundle["districts"][district].items():
            year, month = map(int, date.split("-"))
            if not (2003 <= year <= 2024 and 1 <= month <= 12 and math.isfinite(value) and value >= 0 and image.startswith(asset + "/")):
                raise ValueError("Invalid IMERG record")
            source_images[date] = image
            records[(year - 2003) * 12 + month - 1] = value
        samples["imerg", district, "standard"] = records
    result = compare(samples, pair, "imerg", "standard", (start - 2003) * 12, (end - 2002) * 12)
    return {"comparison": result, "product": asset, "request": {"pair": pair, "start": start, "end": end},
            "units": "mm of monthly precipitation per decade", "boundary_sha256": bundle["boundary_sha256"],
            "image_ids": {date: image for date, image in source_images.items() if start <= int(date[:4]) <= end},
            "method": "Area-weighted monthly precipitation, month fixed effects and 12-month Bartlett HAC."}

def water_context(data_dir, pair, start, end, season_year, observations):
    """Derived precipitation indicators and satellite soil moisture with explicit gaps."""
    import json
    import math
    from statistics import mean

    from analysis import compare

    rain = rainfall_result(data_dir, pair, start, end)
    if rain is None:
        return None
    raw = json.loads((data_dir / "rainfall.json").read_text(encoding="utf-8"))
    months = (7, 8, 9)
    baseline_years = range(2003, 2021)
    seasonal = {}
    sensitivity_data = {}
    for cell in pair:
        by_date = raw["districts"][cell]

        def seasonal_total(year):
            keys = [f"{year}-{month:02}" for month in months]
            if all(key in by_date for key in keys):
                return sum(by_date[key][0] for key in keys)
            return None

        baseline = [value for year in baseline_years if (value := seasonal_total(year)) is not None]
        baseline_mean = mean(baseline) if len(baseline) >= 15 else None
        current = seasonal_total(season_year)
        seasonal[cell] = {
            "season_total_mm": current, "baseline_mean_mm": baseline_mean,
            "baseline_seasons": len(baseline),
            "anomaly_mm": current - baseline_mean if current is not None and baseline_mean is not None else None,
        }
        sensitivity_data["imerg", cell, "standard"] = {
            (int(date[:4]) - 2003) * 12 + int(date[5:]) - 1: value
            for date, (value, _) in by_date.items() if int(date[:4]) not in (2010, 2022)
        }
    excluded = [year for year in (2010, 2022) if start <= year <= end]
    sensitivity = compare(sensitivity_data, pair, "imerg", "standard", (start - 2003) * 12, (end - 2002) * 12)
    soil = None
    soil_path = data_dir / "smap.json"
    if soil_path.is_file():
        soil = json.loads(soil_path.read_text(encoding="utf-8"))
        if (soil["asset"] != "NASA/SMAP/SPL3SMP_E/006" or soil["band"] != "soil_moisture_am"
                or soil["boundary_sha256"] != rain["boundary_sha256"]):
            raise ValueError("Soil moisture source or district boundary mismatch")
        selected = {}
        for cell in pair:
            selected[cell] = {}
            for date, record in soil["districts"][cell].items():
                year, month = map(int, date.split("-"))
                if not (year == 2024 and 1 <= month <= 12 and 0 <= record["value"] <= 1
                        and math.isfinite(record["valid_area_m2"]) and record["valid_area_m2"] > 0
                        and soil["source_images"].get(date)
                        and all(image.startswith(soil["asset"] + "/") for image in soil["source_images"][date])):
                    raise ValueError("Invalid SMAP record")
                if start <= year <= end:
                    selected[cell][date] = record
        soil["districts"] = selected
        soil["source_images"] = {date: images for date, images in soil["source_images"].items()
                                 if start <= int(date[:4]) <= end}
    return {
        **rain,
        "season": {"year": season_year, "months": list(months), "baseline_start": 2003,
                   "baseline_end": 2020, "districts": seasonal,
                   "image_ids": {str(year): [raw["districts"][pair[0]][f"{year}-{month:02}"][1]
                                              for month in months
                                              if f"{year}-{month:02}" in raw["districts"][pair[0]]]
                                 for year in (*baseline_years, season_year)}},
        "sensitivity": {"excluded_years": excluded, "delta": sensitivity["delta"]},
        "soil": soil,
        "historical": historical_water(data_dir, pair, start, end, rain["boundary_sha256"], raw["districts"], observations),
    }



def historical_water(data_dir, pair, start, end, boundary_sha, rainfall, observations):
    """Compare original GLDAS model fields and screen matched months across sources."""
    import json
    import math

    from analysis import compare, estimate

    try:
        model = json.loads((data_dir / "gldas.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    if (model["asset"] != "NASA/GLDAS/V021/NOAH/G025/T3H"
            or model["boundary_sha256"] != boundary_sha
            or model["bands"] != {"soil": "SoilMoi0_10cm_inst", "evap": "Evap_tavg"}):
        raise ValueError("GLDAS source or boundary mismatch")
    expected_dates = {f"{year}-{month:02}" for year in range(2003, 2025) for month in range(1, 13)}
    if model["windows"].keys() != expected_dates:
        return None
    first, last = (start - 2003) * 12, (end - 2002) * 12
    window = {f"{2003 + t // 12}-{t % 12 + 1:02}": t for t in range(first, last)}
    model["windows"] = {date: item for date, item in model["windows"].items() if date in window}
    samples = {(variable, cell, "standard"): {} for variable in ("soil", "evap") for cell in pair}
    coverage = {cell: {} for cell in pair}
    monthly_values = {cell: {} for cell in pair}
    for cell in pair:
        for date, item in model["districts"][cell].items():
            if date not in window:
                continue
            if date not in model["windows"]:
                raise ValueError("GLDAS source time window missing")
            for variable, observation in item.items():
                value, area = observation["value"], observation["valid_area_m2"]
                if not (math.isfinite(value) and math.isfinite(area) and area > 0):
                    raise ValueError("Invalid GLDAS record")
                samples[variable, cell, "standard"][window[date]] = value
                coverage[cell].setdefault(date, {})[variable] = area
                monthly_values[cell].setdefault(date, {})[variable] = value

    ndvi_data, ndvi_manifest = observations
    mismatch = {}
    for cell in pair:
        monthly = {
            "precipitation": {t: rainfall[cell][date][0] for date, t in window.items() if date in rainfall[cell]},
            "soil_moisture": samples["soil", cell, "standard"],
            "greenness": ndvi_data.get(("terra", cell, "standard"), {}),
        }
        shared = sorted(set(monthly["precipitation"]) & set(monthly["soil_moisture"]) & set(monthly["greenness"]))
        trends = {key: estimate({t: series[t] for t in shared}, last - first) for key, series in monthly.items()}
        rain, soil, ndvi = (trends[key]["interval"] for key in monthly)
        state = "insufficient monthly coverage"
        if rain and soil and ndvi:
            signal = soil[1] < 0 and ndvi[1] < 0 and rain[0] <= 0 <= rain[1]
            state = "potential mismatch" if signal else "screening rule not met"
        mismatch[cell] = {"status": state, "trends": trends, "matched_months": shared}
    return {
        **{key: value for key, value in model.items() if key != "districts"},
        "valid_area_m2": coverage,
        "monthly_values": monthly_values,
        "soil": compare(samples, pair, "soil", "standard", first, last),
        "evap": compare(samples, pair, "evap", "standard", first, last),
        "mismatch": mismatch,
        "ndvi_source": ndvi_manifest,
    }
