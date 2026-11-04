"""Explicit directory fields and validation, separate from system account permissions."""

LABELS = {
    "name": "姓名",
    "alias": "别名",
    "department": "部门",
    "position": "职务",
    "gender": "性别",
    "mobile": "手机",
    "telephone": "座机",
    "email": "邮箱",
    "enterpriseEmail": "企业邮箱",
    "englishName": "英文名",
    "sourceDisabled": "源通讯录禁用",
    "activationStatus": "激活状态",
}
LIMITS = {
    "name": 100,
    "department": 1000,
    "gender": 32,
    "mobile": 120,
    "telephone": 120,
    "email": 254,
    "enterpriseEmail": 254,
    "activationStatus": 64,
}


def string_value(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def normalize_fields(raw):
    if not isinstance(raw, dict):
        raise ValueError("实验人员资料必须为对象")
    result = {}
    for key, value in raw.items():
        if key not in LABELS:
            continue
        if key == "sourceDisabled":
            if not isinstance(value, bool):
                raise ValueError("源通讯录禁用状态无效")
        else:
            if not isinstance(value, str):
                raise ValueError(f"{LABELS[key]}须为文本")
            value = value.strip()
            if len(value) > LIMITS.get(key, 200) or any(ord(char) < 32 and char not in "\n\t" for char in value):
                raise ValueError(f"{LABELS[key]}过长或含无效字符")
        result[key] = value
    if "name" in result and not result["name"]:
        raise ValueError("姓名不能为空")
    return result


def empty_fields():
    return {key: False if key == "sourceDisabled" else "" for key in LABELS}
