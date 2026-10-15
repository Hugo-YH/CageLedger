"""Build a disposable restore fixture in a child process with private app paths."""

import io
import json
import shutil

from PIL import Image

from server_app.config import DATA_ROOT, QUARANTINE_FILES_PATH
from server_app.db import connect_db
from server_app.domains.animal_management import create_or_update_inspection, submit_inspection
from server_app.domains.animal_management.service import add_attachment as add_inspection_attachment
from server_app.domains.feedback import files as feedback_files
from server_app.domains.feedback import service as feedback_service
from server_app.domains.quarantine import files as quarantine_files
from server_app.domains.quarantine import repository as quarantine_repo
from server_app.domains.quarantine import service as quarantine_service
from server_app.domains.quarantine.documents import generate
from server_app.domains.reimbursement_ledger.service import add_attachment, save_claim
from server_app.domains.technical_services import service, settlement
from server_app.domains.workflow.application import add_billing_workflow_attachment
from server_app.legacy import initialize_schema
from tests.test_quarantine import sample_test

del initialize_schema  # Configure the actual application's initializer, without starting workers.


def seed():
    actor = {"id": "fixture", "username": "fixture", "displayName": "演练测试", "role": "admin", "roomIds": []}
    image = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(image, format="PNG")
    png = image.getvalue()
    with connect_db() as conn:
        app = {
            "id": "application",
            "iacuc": "Z2026001",
            "pi": "演练负责人",
            "project": "演练项目",
            "funding": "演练经费",
        }
        conn.execute(
            "INSERT INTO experiment_applications(id,iacuc,imported_at,payload) VALUES(?,?,?,?)",
            (app["id"], app["iacuc"], "2026-10-01", json.dumps(app)),
        )
        room = {"id": "drill-room", "name": "演练房间", "facility": "演练设施"}
        conn.execute(
            "INSERT INTO rooms(id,name,area,rack_count,rows,cols,payload) VALUES(?,?,?,0,0,0,?)",
            (room["id"], room["name"], room["facility"], json.dumps(room)),
        )
        conn.commit()
        source = {
            "id": "service",
            "month": "2026-10",
            "iacuc": app["iacuc"],
            "facility": "zhujiang",
            "serviceId": "large_eye_drops",
            "customerType": "internal",
            "rows": [
                {"date": f"2026-10-{day:02}", "quantity": amount} for day, amount in ((1, 2), (2, 2), (3, 4), (10, 2))
            ],
        }
        service.save(conn, actor, {"sheet": source})
        conn.commit()
        preview = settlement.preview(conn, actor, {"month": "2026-10", "pi": app["pi"]})
        bill = settlement.initiate(
            conn, actor, {"month": "2026-10", "pi": app["pi"], "sourceVersions": preview["sourceVersions"]}
        )
        conn.commit()
        add_billing_workflow_attachment(
            conn, actor, bill["workflow"]["id"], "settlement", "settlement.png", png, "image/png"
        )
        conn.commit()
        claim = save_claim(
            conn,
            actor,
            None,
            {
                "documentNumber": "drill-claim",
                "fundingLines": [{"fundBookNo": "F1", "fundingOwner": "演练负责人", "reimbursementAmount": 300}],
            },
        )["item"]
        conn.commit()
        add_attachment(conn, actor, claim["id"], "claim.png", png, "image/png")
        conn.commit()
        inspection = create_or_update_inspection(
            conn,
            actor,
            None,
            {
                "roomId": room["id"],
                "moduleCodes": ["abnormalAnimalAssessment"],
                "answers": [
                    {
                        "moduleCode": "abnormalAnimalAssessment",
                        "nodeCode": "abnormal_07_02_01",
                        "outcome": "abnormal",
                        "note": "演练异常",
                    }
                ],
            },
        )
        submitted = submit_inspection(conn, actor, inspection["item"]["id"])
        add_inspection_attachment(
            conn, actor, inspection["item"]["id"], submitted["findings"][0]["id"], "photo.png", png, "image/png"
        )
        conn.commit()
        feedback = feedback_service.create(
            conn,
            actor,
            {
                "requestId": "drill-feedback",
                "title": "演练反馈",
                "kind": "bug",
                "module": "演练",
                "description": "恢复下载验证",
            },
        )
        conn.commit()
        feedback_files.upload(
            conn, actor, feedback["id"], {"requestId": "drill-asset"}, "feedback.png", png, DATA_ROOT / "files/feedback"
        )
        conn.commit()
        batch = quarantine_service.save_batch(
            conn,
            actor,
            {
                "item": {
                    "id": "batch",
                    "batchNo": "B26100101",
                    "sources": [{"id": "source-a", "supplier": "演练供应商", "species": "小鼠"}],
                }
            },
        )
        conn.commit()
        test = quarantine_service.save_test(conn, actor, {"item": sample_test(batch["id"])})
        conn.commit()
        tiff = io.BytesIO()
        Image.new("RGB", (8, 8), "red").save(tiff, format="TIFF")
        quarantine_files.upload(
            conn,
            actor,
            test["id"],
            {"category": "体内", "sampleId": "sample", "expectedUpdatedAt": test["updatedAt"]},
            "original.tif",
            tiff.getvalue(),
            QUARANTINE_FILES_PATH,
        )
        conn.commit()
        document = quarantine_files.snapshot(conn, quarantine_repo.get(conn, "tests", test["id"]))
        word = generate(document, QUARANTINE_FILES_PATH)
        (QUARANTINE_FILES_PATH / "historical-v1.docx").write_bytes(word)
        # The default suite can run without Writer. When installed, exercise its real legacy endpoint too.
        has_writer = bool(shutil.which("soffice") or shutil.which("libreoffice"))
        if has_writer:
            quarantine_repo.save(
                conn,
                "reports",
                {
                    "id": "old-word",
                    "testId": test["id"],
                    "version": 1,
                    "number": "legacy-word",
                    "snapshot": document,
                    "storageName": "historical-v1.docx",
                    "mime": quarantine_files.DOCX_MIME,
                    "updatedAt": "2026-10-01",
                },
                create=True,
            )
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    (DATA_ROOT / "files/retained-empty").mkdir()
    print(
        json.dumps(
            {
                "wordEndpointExpected": has_writer,
                "amount": preview["statement"]["totalAmount"],
                "serviceDays": preview["statement"]["serviceDayCount"],
            }
        )
    )


if __name__ == "__main__":
    seed()
