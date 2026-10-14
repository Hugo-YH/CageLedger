"""Eye research [2024] No.4, attachment 2. Prices are immutable versions."""

VERSION = "eye-research-2024-4-v1"
SOURCE = "眼科科研〔2024〕4号附件2"
_ITEMS = [
    ("small_eye_drops", "小动物（大小鼠）滴眼", "眼", 10, 20),
    ("large_eye_drops", "大动物滴眼", "眼", 30, 40),
    ("mouse_tail_injection", "尾静脉注射（小鼠）", "只", 20, 60),
    ("rat_tail_injection", "尾静脉注射（大鼠）", "只", 10, 30),
    ("gavage", "灌胃给药（犬、兔）", "只", 50, 70),
    ("rat_orbital_blood", "大鼠眼眶采血", "只", 15, 20),
    ("mouse_orbital_blood", "小鼠眼眶采血", "只", 10, 14),
    ("weaning", "转基因小鼠繁殖断奶分笼", "笼", 50, 150),
    ("veterinary_observation", "普通环境大动物手术后兽医观察费", "小时", 200, 600),
    ("ethics_first", "伦理评审服务费（一次审核通过）", "份", 50, 50),
    ("ethics_revision", "伦理评审服务费（退回修改）", "份", 100, 150),
    ("access_band", "门禁手环", "个", 10, 15),
    ("access_card", "门禁白卡", "个", 10, 15),
    ("transgenic_microinjection", "转基因小鼠制作（显微注射）", "品系", 15000, 60000),
    ("microbial_cleaning", "小鼠品系微生物净化", "品系", 2000, 6000),
    ("ivf_rescue", "小鼠品系挽救 IVF", "品系", 3000, 9000),
    ("cryopreservation", "小鼠品系冻存保种（胚胎、精子）", "品系", 3000, 9000),
    ("ivf_recovery", "IVF 技术小鼠品系恢复", "品系", 3000, 9000),
    ("testicular_transport", "睾丸组织运输", "品系", 1500, 3000),
    ("ovarian_rescue", "卵巢移植挽救小鼠品系", "品系", 1500, 9000),
    ("ivf_expansion", "IVF 技术快速繁殖模型小鼠", "品系", 2000, 6000),
]
CATALOG = [
    {
        "id": identity,
        "name": name,
        "unit": unit,
        "internalPrice": internal,
        "externalPrice": external,
        "version": VERSION,
        "source": SOURCE,
        "notes": "填写已确认计费小时数，至少1小时；连续服务不得超过12小时，单日累计可包含多次服务。"
        if unit == "小时"
        else "",
    }
    for identity, name, unit, internal, external in _ITEMS
]
