from loader import load_config

def describe(values):
    host, port, debug = load_config(values).values()
    return f"{host}:{port} ({'debug' if debug else 'normal'})"
