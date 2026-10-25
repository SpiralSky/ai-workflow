# client.py — uses server API, broken after a recent "refactor"
from server import compute_stats, normalize

def summarize(data: list[float]) -> str:
    stats = compute_stats(data, variance=True)   # BUG: wrong kwarg name
    mean = stats["mean"]
    var = stats.get("variance", "n/a")
    return f"mean={mean}, variance={var}"

def preprocess(data: list[float]) -> list[float]:
    return normalize(data, norm="zscore")         # BUG: wrong kwarg name
