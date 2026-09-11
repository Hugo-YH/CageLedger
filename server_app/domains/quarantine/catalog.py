TEMPLATE_VERSION = "quarantine-2"
PROJECTS = {
    "parasite": ["体内寄生虫", "体外寄生虫"],
    "elisa_mouse": [
        "小鼠肺炎病毒抗体（PVM）",
        "小鼠肝炎病毒抗体（MHV）",
        "小鼠仙台病毒抗体（SV）",
        "小鼠微小病毒抗体（MVM）",
        "小鼠呼肠孤病毒Ⅲ型抗体（Reo-3）",
        "小鼠弓形虫抗体（Toxo）",
        "小鼠肺支原体抗体（MYco）",
        "小鼠泰泽病原体抗体",
    ],
    "elisa_rat": [
        "大鼠仙台病毒抗体（SV）",
        "大鼠呼肠孤病毒Ⅲ抗体（Reo-3）",
        "大鼠肺炎病毒抗体（PVM）",
        "大鼠汉坦病毒抗体（HV）",
        "大鼠细小病毒抗体（H-1株）",
        "大鼠细小病毒抗体（KPV株）",
    ],
    "pcr": [
        "绿脓杆菌",
        "肺炎克雷伯杆菌",
        "嗜肺巴斯德杆菌H型",
        "嗜肺巴斯德杆菌J型",
        "沙门菌",
        "鼠棒状杆菌",
        "支气管鲍特杆菌（大鼠）",
    ],
}

RESULTS = {"negative": "阴性", "positive": "阳性", "suspect": "可疑", "not_tested": "未检测"}
TITLES = {
    "parasite": "体内外寄生虫检测记录表",
    "elisa_mouse": "ELISA检测记录表（小鼠）",
    "elisa_rat": "ELISA检测记录表（大鼠）",
    "pcr": "PCR检测记录表",
}
