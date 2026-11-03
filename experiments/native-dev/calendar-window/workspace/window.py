def query_events(records, start=None, end=None, offset=0, limit=None):
    rows = records[offset:offset + limit if limit else None]
    return [r for r in rows if (start is None or r['timestamp'] >= start) and (end is None or r['timestamp'] <= end)]
