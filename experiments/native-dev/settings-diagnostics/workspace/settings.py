def parse_settings(values):
    return {'host': values.get('host', 'localhost'), 'port': values.get('port',8080), 'debug': bool(values.get('debug',False))}
