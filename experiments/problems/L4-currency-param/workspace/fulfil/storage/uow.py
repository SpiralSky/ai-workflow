from dataclasses import dataclass
from fulfil.storage.repositories import RepositorySet


@dataclass(frozen=True)
class ChangeRecord:
    collection: str
    key: str
    action: str
    before_version: int
    after_version: int


@dataclass(frozen=True)
class CommitReceipt:
    committed: bool
    changes: tuple[ChangeRecord, ...]
    repositories: tuple[str, ...]


class UnitOfWork:
    def __init__(self, repositories: RepositorySet | None = None):
        self.repositories = repositories or RepositorySet()
        self._snapshot = None
        self._entered = False
        self._committed = False
        self._versions: dict[str, int] = {}
        self._changes: list[ChangeRecord] = []
        self.receipt = CommitReceipt(False, (), ())

    def __enter__(self) -> "UnitOfWork":
        if self._entered:
            raise RuntimeError("unit of work cannot be entered twice")
        self._snapshot = {
            "products": self.repositories.products.all(),
            "customers": self.repositories.customers.all(),
            "orders": self.repositories.orders.all(),
            "shipments": self.repositories.shipments.all(),
            "refunds": self.repositories.refunds.all(),
        }
        self._versions = {name: getattr(self.repositories, name).version for name in self._snapshot}
        self._changes = []
        self.receipt = CommitReceipt(False, (), ())
        self._entered = True
        return self

    def commit(self) -> None:
        if not self._entered:
            raise RuntimeError("unit of work is not active")
        self._committed = True
        self.receipt = CommitReceipt(True, tuple(self._changes), tuple(sorted(self._versions)))

    def save(self, collection: str, item) -> None:
        self._require_active()
        repository = self._repository(collection)
        key = str(repository._key_of(item))
        before = repository.version
        repository.save(item)
        self._changes.append(ChangeRecord(collection, key, "save", before, repository.version))

    def add(self, collection: str, item) -> None:
        self._require_active()
        repository = self._repository(collection)
        key = str(repository._key_of(item))
        before = repository.version
        repository.add(item)
        self._changes.append(ChangeRecord(collection, key, "add", before, repository.version))

    def delete(self, collection: str, key: str) -> bool:
        self._require_active()
        repository = self._repository(collection)
        before = repository.version
        deleted = repository.delete(key)
        if deleted:
            self._changes.append(ChangeRecord(collection, str(key), "delete", before, repository.version))
        return deleted

    @property
    def changes(self) -> tuple[ChangeRecord, ...]:
        return tuple(self._changes)

    def _require_active(self) -> None:
        if not self._entered:
            raise RuntimeError("unit of work is not active")

    def _repository(self, collection: str):
        if collection not in {"products", "customers", "orders", "shipments", "refunds"}:
            raise KeyError(f"unknown repository {collection}")
        return getattr(self.repositories, collection)

    def rollback(self) -> None:
        if self._snapshot is None:
            return
        for name, items in self._snapshot.items():
            repository = getattr(self.repositories, name)
            repository.clear()
            for item in items:
                repository.add(item)
        self._committed = False
        self._changes.clear()
        self.receipt = CommitReceipt(False, (), ())

    def __exit__(self, exc_type, exc, traceback) -> bool:
        if exc_type is not None or not self._committed:
            self.rollback()
        self._entered = False
        return False
