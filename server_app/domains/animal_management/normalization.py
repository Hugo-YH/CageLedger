"""Input normalization for animal-inspection records."""

from server_app.shared import clean_text

MODULE_CODES = {"basicAssessment", "advancedAssessment", "abnormalAnimalAssessment"}


def clean_modules(value):
    return [item for item in dict.fromkeys(clean_text(entry) for entry in (value or [])) if item in MODULE_CODES]


def clean_answers(value):
    answers = []
    for item in value or []:
        code = clean_text(item.get("nodeCode"))
        module = clean_text(item.get("moduleCode"))
        if not code or module not in MODULE_CODES:
            continue
        outcome = clean_text(item.get("outcome"))
        score = item.get("score")
        if outcome not in {"normal", "abnormal"}:
            try:
                score = int(score)
            except (TypeError, ValueError):
                continue
            if score not in {1, 2, 3}:
                continue
            outcome = "abnormal" if score < 3 else "normal"
        answers.append(
            {
                "nodeCode": code,
                "moduleCode": module,
                "outcome": outcome,
                "score": 2 if outcome == "abnormal" else 3,
                "subOption": clean_text(item.get("subOption")),
                "note": clean_text(item.get("note")),
                "locationHint": clean_text(item.get("locationHint")),
                "rackHint": clean_text(item.get("rackHint")),
                "cageNumber": clean_text(item.get("cageNumber")),
                "animalIdentifier": clean_text(item.get("animalIdentifier")),
            }
        )
    return answers
