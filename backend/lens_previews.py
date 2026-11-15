"""Summaries for the lenses overview, derived from the same archives as the investigations."""
from statistics import mean

from forest import forest_context
from lenses import rainfall_result
from urban_heat import analyze_heat

START = 2003
END = 2024
# Malir provides a consistent location across the three example series.
PAIR = ("PK714", "PK702")


def complete_years(monthly, reducer):
    """Leave years with incomplete monthly coverage absent."""
    grouped = {}
    for month, malir, _ in monthly:
        grouped.setdefault(START + month // 12, []).append(malir)
    return [[year, reducer(values)] for year, values in sorted(grouped.items()) if len(values) == 12]


def lens_previews(data_dir, observations):
    previews = {}
    rainfall = rainfall_result(data_dir, PAIR, START, END)
    if rainfall is not None:
        previews["water-drought"] = complete_years(rainfall["comparison"]["series"], sum)
    heat = analyze_heat(data_dir, PAIR, START, END, "day", observations)
    if heat is not None:
        monthly = [((int(date[:4]) - START) * 12 + int(date[5:]) - 1, record["day_district"]["value"], None)
                   for date, record in heat["coverage"][PAIR[0]].items() if "day_district" in record]
        previews["urban-heat-growth"] = complete_years(monthly, mean)
    forest = forest_context(data_dir, PAIR, START, END)
    if forest is not None:
        previews["land-cover-forest"] = sorted(forest["districts"][PAIR[0]]["annual"].items())
    return {"region": "Malir", "start": START, "end": END, "series": previews}
