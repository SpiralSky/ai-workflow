from datetime import date, datetime, time, timedelta, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    if not 1 <= month <= 12:
        raise ValueError("month must be between 1 and 12")
    start = datetime.combine(date(year, month, 1), time.min, timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


def within_window(value: datetime, start: datetime, end: datetime) -> bool:
    if value.tzinfo is None or start.tzinfo is None or end.tzinfo is None:
        raise ValueError("window comparisons require timezone-aware datetimes")
    return start <= value < end


def add_business_days(day: date, count: int) -> date:
    if count < 0:
        raise ValueError("business day count cannot be negative")
    current = day
    added = 0
    while added < count:
        current += timedelta(days=1)
        if current.weekday() < 5:
            added += 1
    return current


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed.astimezone(timezone.utc)


def iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("timestamp must be timezone-aware")
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def start_of_day(day: date, zone=timezone.utc) -> datetime:
    return datetime.combine(day, time.min, zone)


def end_of_day(day: date, zone=timezone.utc) -> datetime:
    return datetime.combine(day + timedelta(days=1), time.min, zone)


def age_in_days(value: datetime, now: datetime | None = None) -> int:
    current = now or utc_now()
    if value.tzinfo is None or current.tzinfo is None:
        raise ValueError("age calculation needs timezone-aware timestamps")
    return max(0, (current.astimezone(timezone.utc).date() - value.astimezone(timezone.utc).date()).days)


def week_bounds(day: date) -> tuple[date, date]:
    monday = day - timedelta(days=day.weekday())
    return monday, monday + timedelta(days=7)
