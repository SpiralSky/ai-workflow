from config import PROMOS

def apply_discount(price, pct):
    return round(price * (1 - pct / 100), 2)

def final_price(price, promo="none"):
    return apply_discount(price, PROMOS[promo])
