from services import format_price

class Product:
    def __init__(self, name: str, price: float):
        self.name = name
        self.price = price

    def display(self) -> str:
        return f"{self.name}: {format_price(self.price)}"
