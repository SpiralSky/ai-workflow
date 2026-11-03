from contacts import make_contact

def import_contacts(text):
    lines = text.splitlines()
    if not lines or lines[0] != 'name,email':
        raise ValueError('header')
    return [make_contact(*line.split(',')) for line in lines[1:] if line]
