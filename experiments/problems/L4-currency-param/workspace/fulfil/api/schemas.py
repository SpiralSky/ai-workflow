from dataclasses import dataclass, field
from fulfil.models.customer import Address
from fulfil.models.product import Sku
from fulfil.util.validation import positive_integer, require_text


@dataclass(frozen=True)
class OrderRequest:
    customer_id: str
    lines: list[dict]
    currency: str = "USD"
    shipping_address: Address | None = None
    promotion_code: str | None = None
    allow_backorder: bool = False
    coupon_codes: list[str] = field(default_factory=list)

    def validate(self) -> "OrderRequest":
        require_text(self.customer_id, "customer_id", 80)
        if self.currency not in {"USD", "EUR", "GBP"}:
            raise ValueError("unsupported order currency")
        if not self.lines:
            raise ValueError("order must contain at least one line")
        for row in self.lines:
            if not isinstance(row, dict) or "sku" not in row or "quantity" not in row:
                raise ValueError("each line requires sku and quantity")
            Sku(str(row["sku"]))
            positive_integer(row["quantity"], "quantity")
        if self.promotion_code is not None:
            require_text(self.promotion_code, "promotion_code", 24)
        for code in self.coupon_codes:
            require_text(code, "coupon_code", 24)
        return self


@dataclass(frozen=True)
class ApiResponse:
    status: int
    body: dict = field(default_factory=dict)


@dataclass(frozen=True)
class OrderSummary:
    order_id: str
    status: str
    total: str

    def as_dict(self) -> dict:
        return {"order_id": self.order_id, "status": self.status, "total": self.total}


@dataclass(frozen=True)
class ProductLookup:
    sku: Sku

    @classmethod
    def parse(cls, value: str) -> "ProductLookup":
        return cls(Sku(value))


@dataclass(frozen=True)
class PageRequest:
    offset: int = 0
    limit: int = 20

    def __post_init__(self):
        if self.offset < 0 or not 1 <= self.limit <= 100:
            raise ValueError("page range is invalid")

    def slice(self, values: list) -> list:
        return values[self.offset:self.offset + self.limit]


def error_response(code: str, detail: str | None = None) -> ApiResponse:
    payload = {"error": code}
    if detail:
        payload["detail"] = detail
    return ApiResponse(400, payload)


def page_response(values: list, page: PageRequest) -> dict:
    return {"items": page.slice(values), "total": len(values),
            "offset": page.offset, "limit": page.limit}
