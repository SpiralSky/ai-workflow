# server.py — data processing API

def compute_stats(values: list[float], *, include_variance: bool = False) -> dict:
    """Return mean and optionally variance of a list of values."""
    if not values:
        return {"mean": 0.0}
    mean = sum(values) / len(values)
    result = {"mean": round(mean, 4)}
    if include_variance:
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        result["variance"] = round(variance, 4)
    return result

def normalize(values: list[float], *, method: str = "minmax") -> list[float]:
    """Normalize a list of values. method: "minmax" or "zscore"."""
    if not values:
        return []
    if method == "minmax":
        lo, hi = min(values), max(values)
        if lo == hi:
            return [0.0] * len(values)
        return [(x - lo) / (hi - lo) for x in values]
    elif method == "zscore":
        mean = sum(values) / len(values)
        std = (sum((x - mean) ** 2 for x in values) / len(values)) ** 0.5
        if std == 0:
            return [0.0] * len(values)
        return [(x - mean) / std for x in values]
    else:
        raise ValueError(f"Unknown method: {method}")
