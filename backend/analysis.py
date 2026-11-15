"""Paired NDVI slopes with calendar-month effects and calendar-lag HAC."""
from itertools import combinations
import numpy as np


def estimate(series, expected, *, periods_per_year=12, min_observations=60, max_lag=12):
    n = len(series)
    if n < min_observations or n < expected / 2:
        return {"slope": None, "interval": None, "months": n}
    t = np.array(sorted(series))
    y = np.array([series[i] for i in t], dtype=float)
    x = t.astype(float)
    groups = np.unique(t % periods_per_year)
    for group in groups:
        select = t % periods_per_year == group
        x[select] -= x[select].mean()
        y[select] -= y[select].mean()
    xx = x @ x
    if xx == 0:
        return {"slope": None, "interval": None, "months": n}
    slope = float(x @ y / xx)
    score = dict(zip(t, x * (y - slope * x)))
    meat = sum(v * v for v in score.values())
    for lag in range(1, max_lag + 1):
        meat += 2 * (1 - lag / (max_lag + 1)) * sum(v * score.get(i-lag, 0) for i, v in score.items())
    decade = 10 * periods_per_year
    half = 1.96 * decade * float(np.sqrt(max(0, meat) * n / (n-len(groups)-1))) / xx
    value = slope * decade
    return {"slope": value, "interval": [value-half, value+half], "months": n}


def window(records, start, end):
    return {t: y for t, y in records.items() if start <= t < end}


def compare(data, pair, source, quality, start, end):
    a, b = (window(data.get((source, cell, quality), {}), start, end) for cell in pair)
    common = sorted(a.keys() & b.keys())
    return {
        "left": estimate({t: a[t] for t in common}, end-start),
        "right": estimate({t: b[t] for t in common}, end-start),
        "delta": estimate({t: a[t]-b[t] for t in common}, end-start),
        "series": [[t, a[t], b[t]] for t in common],
    }


def scan(data, ids, quality, start, end):
    trends = {cell: estimate(window(data.get(("terra", cell, quality), {}), start, end), end-start)
              for cell in ids}
    candidates = []
    for a, b in combinations(ids, 2):
        if trends[a]["slope"] is None or trends[b]["slope"] is None:
            continue
        result = compare(data, [a,b], "terra", quality, start, end)
        delta = result["delta"]["slope"]
        if delta is not None and abs(delta) >= .02:
            opposite = result["left"]["slope"] * result["right"]["slope"] < 0
            candidates.append({"pair":[a,b], "delta":delta, "opposite":opposite})
    candidates.sort(key=lambda item: (item["opposite"], abs(item["delta"])), reverse=True)
    return {"trends": trends, "candidates": candidates, "exploratory": True}
