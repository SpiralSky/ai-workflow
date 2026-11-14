from fulfil.api.handlers import Application, create_application, get_product, place_order

__all__ = ["Application", "create_application", "get_product", "place_order"]


def is_success(response) -> bool:
    return 200 <= response.status < 300
