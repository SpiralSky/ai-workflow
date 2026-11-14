from fulfil.storage.repositories import RepositorySet
from fulfil.storage.uow import ChangeRecord, CommitReceipt, UnitOfWork

__all__ = ["ChangeRecord", "CommitReceipt", "RepositorySet", "UnitOfWork"]


def new_repositories() -> RepositorySet:
    return RepositorySet()
