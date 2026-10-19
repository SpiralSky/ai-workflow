from service import ProductService

_svc = ProductService()


def handle_get(product_id: str):
    product = _svc.get(product_id)
    if product is None:
        return {"error": "not found"}, 404
    return product, 200


def handle_create(product_id: str, data: dict):
    try:
        product = _svc.create(product_id, data)
        return product, 201
    except ValueError as e:
        return {"error": str(e)}, 409


def handle_update(product_id: str, data: dict):
    try:
        product = _svc.update(product_id, data)
        return product, 200
    except KeyError as e:
        return {"error": str(e)}, 404


def handle_delete(product_id: str):
    try:
        _svc.delete(product_id)
        return {}, 204
    except KeyError as e:
        return {"error": str(e)}, 404
