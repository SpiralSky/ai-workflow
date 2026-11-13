# fulfil

A standard-library Python 3.12 order-fulfilment backend. The API is a set of
plain functions; storage is in memory and repositories return copies of models.

Run the test suite from this directory:

```sh
python3.12 -m unittest discover -s tests -v
```

`fulfil.api.handlers.create_application()` assembles repositories, services,
an event bus and the product cache. `fulfil.cli.commands.AdminCommands` exposes
administrative operations over the same application. Services handle order
placement, inventory reservations and backorders, shipping, invoices, refunds
and notifications. Reports aggregate stored orders, refunds and stock.

Pricing combines quantity rules, promotions, tax and rounding. Models enforce
currency and lifecycle constraints; JSON serialization supports stored fixtures
and migration of older order records. Event handlers update reports and
invalidate cached product data.

Tests exercise the API and CLI, service workflows, model validation, pricing,
repository transactions, serialization fixtures and module imports in fresh
interpreters. No network service or third-party Python dependency is needed.
