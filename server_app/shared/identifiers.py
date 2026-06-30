import secrets


def new_id(prefix):
    return f"{prefix}-{secrets.token_hex(8)}"
