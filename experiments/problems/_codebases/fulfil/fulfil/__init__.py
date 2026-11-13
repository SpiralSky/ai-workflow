"""Order fulfilment services for a small online shop."""

from fulfil.config import Settings

__all__ = ["Settings"]


def default_settings() -> Settings:
    return Settings()
