from dataclasses import dataclass, field
from fulfil.util.validation import require_email
from fulfil.util.validation import validate_country_code, validate_postal_code


@dataclass(frozen=True)
class Address:
    recipient: str
    line1: str
    city: str
    postal_code: str
    country: str = "US"
    line2: str = ""

    def __post_init__(self) -> None:
        for name in ("recipient", "line1", "city", "postal_code", "country"):
            if not getattr(self, name).strip():
                raise ValueError(f"{name} is required")
        validate_country_code(self.country)
        validate_postal_code(self.postal_code, self.country)

    def one_line(self) -> str:
        parts = [self.recipient, self.line1, self.line2, self.city, self.postal_code, self.country]
        return ", ".join(part.strip() for part in parts if part.strip())

    def delivery_key(self) -> tuple[str, str, str, str]:
        return (" ".join(self.line1.casefold().split()), " ".join(self.city.casefold().split()),
                self.postal_code.replace(" ", "").casefold(), self.country.upper())


@dataclass
class Customer:
    customer_id: str
    name: str
    email: str
    addresses: list[Address] = field(default_factory=list)
    marketing_opt_in: bool = False

    def __post_init__(self) -> None:
        require_email(self.email)
        if not self.customer_id or not self.name.strip():
            raise ValueError("customer id and name are required")

    def primary_address(self) -> Address:
        if not self.addresses:
            raise ValueError("customer has no delivery address")
        return self.addresses[0]

    def add_address(self, address: Address, make_primary: bool = False) -> None:
        duplicate = next((index for index, existing in enumerate(self.addresses)
                          if existing.delivery_key() == address.delivery_key()), None)
        if duplicate is not None:
            existing = self.addresses.pop(duplicate)
            self.addresses.insert(0 if make_primary else len(self.addresses), existing)
            return
        if make_primary:
            self.addresses.insert(0, address)
        else:
            self.addresses.append(address)

    def remove_address(self, index: int) -> Address:
        if index < 0 or index >= len(self.addresses):
            raise IndexError("address index is out of range")
        return self.addresses.pop(index)

    def update_email(self, email: str) -> None:
        self.email = require_email(email)

    def public_profile(self) -> dict[str, str | bool]:
        return {"customer_id": self.customer_id, "name": self.name,
                "email": self.email, "marketing_opt_in": self.marketing_opt_in}

    def set_marketing_opt_in(self, enabled: bool) -> None:
        self.marketing_opt_in = bool(enabled)

    def address_index(self, address: Address) -> int:
        return next((index for index, existing in enumerate(self.addresses)
                     if existing.delivery_key() == address.delivery_key()), -1)

    def can_receive_marketing(self) -> bool:
        return self.marketing_opt_in and bool(self.email)
