import re
from datetime import date

from server_app.shared import as_int, clean_text


def base36_encode(value):
    digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    number = int(value or 0)
    if number <= 0:
        return "0"
    output = ""
    while number:
        number, remainder = divmod(number, 36)
        output = digits[remainder] + output
    return output


def hash_base36(value, length=8):
    hash_value = 1469598103934665603
    mask = (1 << 64) - 1
    for char in str(value or ""):
        hash_value ^= ord(char)
        hash_value = (hash_value * 1099511628211) & mask
    return base36_encode(hash_value).rjust(length, "0")[-length:]


CAGE_CARD_QR_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

CAGE_CARD_QR_LENGTH = 4

CAGE_CARD_QR_CAPACITY = len(CAGE_CARD_QR_ALPHABET) ** CAGE_CARD_QR_LENGTH

CAGE_CARD_QR_MULTIPLIER = 739391

CAGE_CARD_QR_OFFSET = 48691


def modular_inverse(value, modulo):
    current = value
    next_value = modulo
    current_coeff = 1
    next_coeff = 0
    while next_value:
        quotient = current // next_value
        current, next_value = next_value, current - quotient * next_value
        current_coeff, next_coeff = next_coeff, current_coeff - quotient * next_coeff
    if current != 1:
        raise ValueError("短码置换参数无效")
    return current_coeff % modulo


CAGE_CARD_QR_INVERSE = modular_inverse(CAGE_CARD_QR_MULTIPLIER, CAGE_CARD_QR_CAPACITY)


def is_cage_card_qr_id(value):
    text = clean_text(value).upper()
    return bool(
        re.fullmatch(rf"[{CAGE_CARD_QR_ALPHABET}]{{{CAGE_CARD_QR_LENGTH}}}", text) or re.fullmatch(r"[A-Z0-9]{8}", text)
    )


def encode_cage_card_sequence(sequence):
    value = max(as_int(sequence) or 1, 1)
    permuted = ((value - 1) * CAGE_CARD_QR_MULTIPLIER + CAGE_CARD_QR_OFFSET) % CAGE_CARD_QR_CAPACITY
    output = ""
    number = permuted
    for _ in range(CAGE_CARD_QR_LENGTH):
        output = CAGE_CARD_QR_ALPHABET[number % len(CAGE_CARD_QR_ALPHABET)] + output
        number //= len(CAGE_CARD_QR_ALPHABET)
    return output


def decode_cage_card_sequence(qr_id):
    text = clean_text(qr_id).upper()
    if not re.fullmatch(rf"[{CAGE_CARD_QR_ALPHABET}]{{{CAGE_CARD_QR_LENGTH}}}", text):
        return None
    number = 0
    for char in text:
        digit = CAGE_CARD_QR_ALPHABET.find(char)
        if digit < 0:
            return None
        number = number * len(CAGE_CARD_QR_ALPHABET) + digit
    return (((number - CAGE_CARD_QR_OFFSET + CAGE_CARD_QR_CAPACITY) * CAGE_CARD_QR_INVERSE) % CAGE_CARD_QR_CAPACITY) + 1


def collect_cage_card_qr_ids(state, exclude_batch_id=""):
    used = set()
    excluded_task_ids = set()

    def add(value):
        qr_id = clean_text(value).upper()
        if is_cage_card_qr_id(qr_id):
            used.add(qr_id)

    for batch in state.get("intakeBatches", []):
        if exclude_batch_id and batch.get("id") == exclude_batch_id:
            continue
        for card in batch.get("cards") or []:
            if isinstance(card, dict):
                add(card.get("qrId"))
    for task in state.get("placementTasks", []):
        if exclude_batch_id and task.get("sourceBatchId") == exclude_batch_id:
            if task.get("id"):
                excluded_task_ids.add(task.get("id"))
            continue
        add(task.get("qrId"))
    for occupancy in state.get("occupancies", []):
        if (
            exclude_batch_id
            and occupancy.get("placementTaskId")
            and occupancy.get("placementTaskId") in excluded_task_ids
        ):
            continue
        add(occupancy.get("qrId"))
    return used


def next_cage_card_qr_id(used_qr_ids):
    next_sequence = 1
    for qr_id in used_qr_ids:
        sequence = decode_cage_card_sequence(qr_id)
        if sequence:
            next_sequence = max(next_sequence, sequence + 1)
    for offset in range(CAGE_CARD_QR_CAPACITY):
        candidate = encode_cage_card_sequence(next_sequence + offset)
        if candidate not in used_qr_ids:
            return candidate
    raise ValueError("笼卡短码已用尽")


def cage_card_qr_id(batch, sequence):
    batch_id = clean_text(batch.get("id") or batch.get("sourceBatchId") or "batch") or "batch"
    card_no = str(max(as_int(sequence) or 0, 0)).zfill(2)
    return hash_base36(f"{batch_id}:{card_no}", 8)


def cage_card_qr_id_from_batch_card(batch, sequence):
    cards = batch.get("cards") if isinstance(batch.get("cards"), list) else []
    index = max(as_int(sequence) or 0, 0) - 1
    if 0 <= index < len(cards) and isinstance(cards[index], dict):
        qr_id = clean_text(cards[index].get("qrId")).upper()
        if is_cage_card_qr_id(qr_id):
            return qr_id
    return cage_card_qr_id(batch, sequence)


def legacy_cage_card_qr_id(batch, sequence):
    iacuc = clean_text(batch.get("iacuc") or "NOIACUC") or "NOIACUC"
    intake_date = clean_text(batch.get("intakeDate") or "nodate").replace("-", "")
    card_no = str(max(as_int(sequence) or 0, 0)).zfill(2)
    return "-".join([iacuc, intake_date, card_no])


def species_label(value):
    return {
        "mouse": "小鼠",
        "rat": "大鼠",
        "guinea_pig": "豚鼠",
        "rabbit": "兔",
        "monkey": "猴",
        "dog": "犬",
        "pig": "猪",
    }.get(clean_text(value), clean_text(value))


def cage_card_status_label(batch, task, occupancy):
    if occupancy:
        return {"reserved": "已预留", "active": "已入驻", "ended": "已结束"}.get(
            occupancy.get("status"), occupancy.get("status", "")
        )
    if task:
        return {"pending": "待进驻", "reserved": "已预留", "active": "已入驻", "cancelled": "已取消"}.get(
            task.get("status"), task.get("status", "")
        )
    return {"draft": "草稿", "pending_print": "未打印", "printed": "已打印", "received": "已接收"}.get(
        batch.get("status"), batch.get("status", "")
    )


def animal_age_text(birth_date, reference_date=None):
    raw = clean_text(birth_date)
    if not raw:
        return ""
    try:
        birth = date.fromisoformat(raw)
        reference = date.fromisoformat(clean_text(reference_date)) if reference_date else date.today()
    except ValueError:
        return ""
    if reference < birth:
        return ""
    months = (reference.year - birth.year) * 12 + reference.month - birth.month
    if reference.day < birth.day:
        months -= 1
    years = months // 12
    remaining_months = months % 12
    if years and remaining_months:
        return f"{years}岁{remaining_months}个月"
    if years:
        return f"{years}岁"
    return f"{max(months, 0)}个月"
