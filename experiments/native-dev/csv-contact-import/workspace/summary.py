from importer import import_contacts

def render(text):
    return "\n".join(f"{r['name']} <{r['email']}>" for r in import_contacts(text))
