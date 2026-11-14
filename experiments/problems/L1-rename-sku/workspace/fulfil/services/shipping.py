from dataclasses import dataclass
from fulfil.events.bus import EventBus
from fulfil.events.types import ShipmentLabelCreated
from fulfil.models.customer import Address
from fulfil.models.money import Money
from fulfil.models.order import Order
from fulfil.models.fulfillment import Shipment
from fulfil.pricing import (
    chargeable_weight_grams, choose_shipping_rate, compare_unit_prices,
    service_fee, shipping_discount, surcharge_for_remote_postcode,
)
from fulfil.storage.repositories import RepositorySet
from fulfil.util.ids import new_id


@dataclass(frozen=True)
class ShippingRate:
    carrier: str
    service: str
    amount: Money
    estimated_days: int
    zone: str = "domestic"
    billable_grams: int = 0


class ShippingService:
    def __init__(self, repositories: RepositorySet, bus: EventBus | None = None):
        self.repositories = repositories
        self.bus = bus

    def rates(self, order: Order, destination: Address, preferred_zone: str | None = None) -> list[ShippingRate]:
        weight = 0
        volume = 0
        for line in order.lines:
            product = self.repositories.products.find(str(line.sku))
            if product:
                weight += product.weight_grams * line.quantity
                volume += product.volume_cm3 * line.quantity
        billable = chargeable_weight_grams(weight, volume)
        zone = preferred_zone or ("domestic" if destination.country == "US" else
                                  "nearby" if destination.country in {"CA", "MX"} else "international")
        base_rates = {"domestic": (595, 1295, 5, 2), "nearby": (1195, 2195, 8, 4),
                      "international": (1895, 3495, 12, 6)}
        if zone not in base_rates:
            raise ValueError(f"unknown shipping zone {zone}")
        standard_minor, express_minor, standard_days, express_days = base_rates[zone]
        weight_fee = max(0, (billable - 500 + 499) // 500) * 125
        standard_amount = Money(standard_minor + weight_fee, order.currency)
        express_amount = Money(express_minor + weight_fee, order.currency)
        remote = surcharge_for_remote_postcode(destination.postal_code,
                                               Money(450, order.currency),
                                               ("AK", "HI", "PR", "995", "996", "997", "998", "999",
                                                "967", "968", "006", "007", "008", "009"))
        standard_amount += remote
        express_amount += remote
        if order.item_subtotal.minor >= 7500 and zone == "domestic":
            standard_amount = shipping_discount(standard_amount, Money(standard_amount.minor, order.currency))
        return [ShippingRate("parcel-post" if zone == "domestic" else "global-mail", "standard",
                             standard_amount, standard_days, zone, billable),
                ShippingRate("parcel-post" if zone == "domestic" else "global-mail", "express",
                             express_amount, express_days, zone, billable)]

    def create_label(self, order: Order, rate: ShippingRate) -> Shipment:
        if order.shipping_address is None:
            raise ValueError("order has no destination address")
        if rate.amount.currency != order.currency:
            raise ValueError("shipping rate currency differs from order")
        destination = order.shipping_address
        assert isinstance(destination, Address)
        shipment = Shipment(new_id("shp"), order.order_id, rate.carrier, rate.service,
                            zone=rate.zone, weight_grams=rate.billable_grams,
                            label_payload={"recipient": destination.recipient,
                                           "line1": destination.line1,
                                           "postal_code": destination.postal_code,
                                           "country": destination.country,
                                           "order_total_minor": str(order.total.minor)})
        shipment.attach_label(new_id("trk").replace("-", "").upper())
        self.repositories.shipments.add(shipment)
        if self.bus:
            self.bus.publish(ShipmentLabelCreated(shipment.shipment_id, order.order_id,
                                                  shipment.tracking_number, shipment.carrier))
        return shipment

    def dispatch(self, shipment_id: str, carrier_scan: str = "") -> Shipment:
        shipment = self.repositories.shipments.get(shipment_id)
        shipment.mark_in_transit(carrier_scan)
        self.repositories.shipments.save(shipment)
        return shipment

    def confirm_delivery(self, shipment_id: str, delivered_at=None) -> Shipment:
        shipment = self.repositories.shipments.get(shipment_id)
        shipment.mark_delivered(delivered_at)
        self.repositories.shipments.save(shipment)
        return shipment

    def for_order(self, order_id: str) -> list[Shipment]:
        return sorted([shipment for shipment in self.repositories.shipments.all()
                       if shipment.order_id == order_id], key=lambda shipment: shipment.shipment_id)

    def quote_for_postcode(self, order: Order, postcode: str) -> list[ShippingRate]:
        if not postcode.strip():
            raise ValueError("postal code is required")
        destination = order.shipping_address
        if destination is None:
            raise ValueError("order has no shipping address")
        if postcode.strip().upper() == destination.postal_code.strip().upper():
            return self.rates(order, destination)
        overridden = Address(destination.recipient, destination.line1, destination.city,
                             postcode.strip(), destination.country, destination.line2)
        return self.rates(order, overridden)

    def tracking_lookup(self, tracking_number: str) -> Shipment | None:
        normalized = tracking_number.strip().casefold()
        return next((shipment for shipment in self.repositories.shipments.all()
                     if shipment.tracking_number.casefold() == normalized), None)

    def parcel_surcharge(self, order: Order, weight_grams: int, volume_cm3: int) -> Money:
        billable_weight = chargeable_weight_grams(weight_grams, volume_cm3)
        base = Money(max(0, billable_weight - 1000), order.currency)
        return service_fee(base, 125)

    def select_rate(self, rates: list[ShippingRate], express: bool = False,
                    maximum: Money | None = None) -> ShippingRate:
        if not rates:
            raise ValueError("no shipping rates are available")
        ordered = sorted(rates, key=lambda rate: rate.amount.minor)
        chosen_amount = choose_shipping_rate(Money(0, ordered[0].amount.currency), ordered[0].amount,
                                             ordered[-1].amount, express_selected=express)
        chosen = next(rate for rate in ordered if rate.amount == chosen_amount)
        if maximum:
            candidates = [rate for rate in rates if rate.amount.currency == maximum.currency
                          and rate.amount.minor <= maximum.minor]
            if not candidates:
                raise ValueError("no shipping option is below the customer's limit")
            chosen = max(candidates, key=lambda rate: (rate.estimated_days * -1, -rate.amount.minor))
        return chosen

    def cheapest_for_zone(self, order: Order, destination: Address, zone: str) -> ShippingRate:
        rates = self.rates(order, destination, zone)
        return min(rates, key=lambda rate: rate.amount.minor)

    def compare_carriers(self, first: ShippingRate, second: ShippingRate) -> int:
        return compare_unit_prices(first.amount, 1, second.amount, 1)

    def rate_after_coupon(self, rate: ShippingRate, coupon: Money) -> ShippingRate:
        return ShippingRate(rate.carrier, rate.service,
                            shipping_discount(rate.amount, coupon), rate.estimated_days,
                            rate.zone, rate.billable_grams)
