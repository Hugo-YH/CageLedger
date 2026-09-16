"""Read issued settlement versions without consulting current billing inputs."""

from server_app.domains.workflow.constants import FROZEN_WORKFLOW_STATUSES
from server_app.repositories.billing_statements import list_billing_statement_lines_for_version
from server_app.repositories.workflow_documents import frozen_workflow_version


def frozen_statement(conn, month, pi, source_type, *, source_id="", iacuc=""):
    version = frozen_workflow_version(
        conn, month, pi, source_type, FROZEN_WORKFLOW_STATUSES, source_id=source_id, iacuc=iacuc
    )
    if version is None:
        return None
    statement = version.get("statement")
    if not statement or not version.get("id"):
        raise ValueError("已发起流程的结算内容缺失，请核查历史记录")
    return statement, list_billing_statement_lines_for_version(conn, version["id"])
