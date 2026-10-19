from services import format_price  # circular: services also imports from models

class Product:
    def __init__(self, name: str, price: float):
        self.name = name
        self.price = price

    def display(self) -> str:
        return f"{self.name}: {format_price(self.price)}"
