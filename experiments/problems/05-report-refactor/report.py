def format_sales(rows):
    out = ["== Sales =="]
    total = 0
    for name, amt in rows:
        out.append(f"  {name:<10} {amt:>8.2f}")
        total += amt
    out.append(f"  {'TOTAL':<10} {total:>8.2f}")
    return "\n".join(out)

def format_costs(rows):
    out = ["== Costs =="]
    total = 0
    for name, amt in rows:
        out.append(f"  {name:<10} {amt:>8.2f}")
        total += amt
    out.append(f"  {'TOTAL':<10} {total:>8.2f}")
    return "\n".join(out)

def format_refunds(rows):
    out = ["== Refunds =="]
    for name, amt in rows:
        out.append(f"  {name:<10} {-amt:>8.2f}")
    return "\n".join(out)

def build_report(sales, costs, refunds):
    return "\n\n".join([format_sales(sales), format_costs(costs), format_refunds(refunds)])
