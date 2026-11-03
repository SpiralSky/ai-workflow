from window import query_events

def render_window(store, **options):
    return "\n".join(row['id'] for row in query_events(store.records, **options))
