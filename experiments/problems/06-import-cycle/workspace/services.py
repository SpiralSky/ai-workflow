from models import Product  # circular: models also imports from services

def format_price(amount: float) -> str:
    return f"${amount:.2f}"

def make_product(name: str, price: float) -> Product:
    return Product(name, price)

def describe(product: Product) -> str:
    return product.display()
