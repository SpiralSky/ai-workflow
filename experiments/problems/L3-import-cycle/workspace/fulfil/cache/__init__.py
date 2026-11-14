from fulfil.cache.readthrough import ReadThroughCache

__all__ = ["ReadThroughCache"]


def product_cache() -> ReadThroughCache:
    return ReadThroughCache(ttl_seconds=45, max_entries=512)
