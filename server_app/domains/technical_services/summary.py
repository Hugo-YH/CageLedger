"""Merge service costs into the existing PI / IACUC / facility export rows."""

from server_app.domains.billing.monthly_summary import FACILITY_LABELS


def merge_service_rows(rows, sheets, applications, reimbursement_by_pi):
    by_key = {(r["pi"], r["iacuc"], r["facility"]): {**r, "technicalServiceAmount": 0.0} for r in rows}
    for sheet in sheets:
        facility = FACILITY_LABELS[sheet["facility"]]
        key = (sheet["pi"], sheet["iacuc"], facility)
        if key not in by_key:
            application = applications.get(sheet["iacuc"], {})
            reimbursement = reimbursement_by_pi.get(sheet["pi"], {})
            by_key[key] = {
                "pi": sheet["pi"],
                "iacuc": sheet["iacuc"],
                "facility": facility,
                "funding": sheet["funding"],
                "species": "",
                "amount": 0.0,
                "supportAmount": 0.0,
                "payableAmount": 0.0,
                "technicalServiceAmount": 0.0,
                "statementReturned": reimbursement.get("statementReturned", ""),
                "fundBookNo": reimbursement.get("fundBookNo", ""),
                "reimbursementFormNo": reimbursement.get("reimbursementFormNo", ""),
                "reimbursementAmount": reimbursement.get("reimbursementAmount", 0),
                "reimbursementNotes": reimbursement.get("notes", ""),
                "projectStartDate": application.get("projectStartDate", ""),
                "projectEndDate": application.get("projectEndDate", ""),
                "notes": "",
                "roomNames": "",
            }
        by_key[key]["technicalServiceAmount"] = round(by_key[key]["technicalServiceAmount"] + sheet["totalAmount"], 2)
    return sorted(by_key.values(), key=lambda r: (r["pi"], r["facility"], r["iacuc"]))
