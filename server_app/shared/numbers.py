def as_int(value):
    return int(value) if value not in (None, "") else None


def as_float(value):
    return float(value) if value not in (None, "") else None
