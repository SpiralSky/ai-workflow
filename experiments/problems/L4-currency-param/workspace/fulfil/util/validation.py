import re

_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def require_email(value: str) -> str:
    value = value.strip()
    if not _EMAIL.match(value):
        raise ValueError("a valid email address is required")
    return value


def positive_integer(value: object, field: str = "value") -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return value


def require_text(value: str, field: str, limit: int = 200) -> str:
    cleaned = " ".join(value.split())
    if not cleaned or len(cleaned) > limit:
        raise ValueError(f"{field} must contain 1 to {limit} characters")
    return cleaned


def one_of(value: str, choices: set[str], field: str) -> str:
    if value not in choices:
        raise ValueError(f"{field} must be one of {', '.join(sorted(choices))}")
    return value


def bounded_integer(value: object, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    if not minimum <= value <= maximum:
        raise ValueError(f"{field} must be between {minimum} and {maximum}")
    return value


def validate_sku(value: str) -> str:
    normalized = value.strip().upper()
    if not normalized or len(normalized) > 32:
        raise ValueError("SKU must be between 1 and 32 characters")
    if any(not (character.isalnum() or character in "-_./") for character in normalized):
        raise ValueError("SKU contains an invalid character")
    return normalized


def validate_country_code(value: str) -> str:
    code = value.strip().upper()
    if len(code) != 2 or not code.isalpha():
        raise ValueError("country code must have two letters")
    return code


def validate_postal_code(value: str, country: str = "US") -> str:
    code = " ".join(value.upper().split())
    if not code or len(code) > 16:
        raise ValueError("postal code must be between 1 and 16 characters")
    if country.upper() == "US" and not re.fullmatch(r"\d{5}(-\d{4})?", code):
        raise ValueError("US postal code must be ZIP or ZIP+4")
    return code


def validate_metadata(metadata: dict[str, str], max_fields: int = 20) -> dict[str, str]:
    if len(metadata) > max_fields:
        raise ValueError("too many metadata fields")
    cleaned = {}
    for key, value in metadata.items():
        clean_key = require_text(key, "metadata key", 40)
        clean_value = require_text(value, "metadata value", 200)
        cleaned[clean_key] = clean_value
    return cleaned
