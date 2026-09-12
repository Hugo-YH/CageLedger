from . import repository as repo
from .service import abnormal_samples, split_retest_completed


def _date_matches(item, field, filters):
    return (not filters.get("dateFrom") or item[field] >= filters["dateFrom"]) and (
        not filters.get("dateTo") or item[field] <= filters["dateTo"]
    )


def supplier_history(conn, filters):
    rows = {}
    for batch in repo.all_items(conn, "batches"):
        sources = {s["id"]: s for s in batch["sources"]}
        matching_by_supplier = {}
        for supplier in {s["supplier"] for s in sources.values()}:
            if filters.get("supplier") and filters["supplier"].casefold() not in supplier.casefold():
                continue
            matching = [
                s
                for s in sources.values()
                if s["supplier"] == supplier
                and (not filters.get("species") or filters["species"] in s["species"])
                and (filters.get("dateType") == "test" or _date_matches(s, "intakeDate", filters))
            ]
            if matching:
                matching_by_supplier[supplier] = matching
        if not matching_by_supplier:
            continue
        # Keep every test in a matching batch so corrections and split retests retain their context.
        tests = repo.all_items(conn, "tests", batch["id"])
        # A correction supersedes its prior version for counts, not for history retention.
        superseded = {t["correctionOf"] for t in tests if t.get("correctionOf") and t["state"] == "issued"}
        for test in tests:
            if test["id"] in superseded or (test.get("correctionOf") and test["state"] == "draft"):
                continue
            if filters.get("method") and test["method"] != filters["method"]:
                continue
            if filters.get("dateType") == "test" and not _date_matches(test, "testDate", filters):
                continue
            abnormal = abnormal_samples(test)
            results = [p["results"].get(sid, "") for p in test["projects"] for sid in p["sampleIds"]]
            for supplier, matching in matching_by_supplier.items():
                ids = {s["id"] for s in matching}
                samples = [s for s in test["samples"] if ids.intersection(s["sourceIds"])]
                pending = any(
                    s["id"] in abnormal and len({sources[sid]["supplier"] for sid in s["sourceIds"]}) > 1
                    for s in samples
                )
                resolved = pending and all(
                    split_retest_completed(tests, test["id"], s["id"], supplier, sources)
                    for s in samples
                    if s["id"] in abnormal and len({sources[sid]["supplier"] for sid in s["sourceIds"]}) > 1
                )
                confirmed = any(
                    s["id"] in abnormal and len({sources[sid]["supplier"] for sid in s["sourceIds"]}) == 1
                    for s in samples
                )
                status = (
                    "confirmed"
                    if confirmed
                    else "resolved"
                    if resolved
                    else "pending"
                    if pending
                    else "normal"
                    if results and all(r == "negative" for r in results)
                    else "incomplete"
                )
                if filters.get("result") and filters["result"] != status:
                    continue
                key = (supplier, test["method"], bool(test.get("retestOf")))
                row = rows.setdefault(
                    key,
                    {
                        "supplier": supplier,
                        "method": test["method"],
                        "retest": bool(test.get("retestOf")),
                        "intakeIds": set(),
                        "batchIds": set(),
                        "poolCount": 0,
                        "portionCount": 0,
                        "confirmed": 0,
                        "pending": 0,
                        "resolved": 0,
                        "normal": 0,
                        "incomplete": 0,
                        "details": [],
                    },
                )
                row["intakeIds"].update(s["intakeId"] for s in matching if s["intakeId"])
                row["batchIds"].add(batch["id"])
                row["poolCount"] += sum(s["poolCount"] for s in samples)
                row["portionCount"] += sum(s["portionCount"] for s in samples)
                row[status] += 1
                row["details"].append(
                    {
                        "batchId": batch["id"],
                        "batchName": batch["name"],
                        "testId": test["id"],
                        "testDate": test["testDate"],
                        "status": status,
                        "sharedPools": any(
                            len({sources[sid]["supplier"] for sid in s["sourceIds"]}) > 1 for s in samples
                        ),
                    }
                )
    return [
        {
            **row,
            "intakeIds": sorted(row["intakeIds"]),
            "batchIds": sorted(row["batchIds"]),
            "intakeCount": len(row["intakeIds"]),
            "batchCount": len(row["batchIds"]),
        }
        for row in rows.values()
    ]
