"""Actor-specific withdrawal capabilities, projected after shared response caches."""

from .constants import WORKFLOW_STATUS_ARCHIVED, WORKFLOW_STATUS_GENERATED, WORKFLOW_STATUS_SENT
from .repository import list_workflow_withdrawal_owners


def withdrawal_capabilities(conn, actor, workflow_ids):
    owners = list_workflow_withdrawal_owners(conn, workflow_ids)
    actor_id = actor.get("id")
    result = {}
    for workflow_id, item in owners.items():
        status = item["status"]
        if actor.get("role") == "admin":
            allowed = status in (WORKFLOW_STATUS_GENERATED, WORKFLOW_STATUS_SENT, WORKFLOW_STATUS_ARCHIVED)
        else:
            owner_id = item["generatedBy"] if status == WORKFLOW_STATUS_GENERATED else item["sentBy"]
            allowed = (
                actor.get("role") == "room_admin"
                and status in (WORKFLOW_STATUS_GENERATED, WORKFLOW_STATUS_SENT)
                and bool(actor_id)
                and actor_id == owner_id
            )
        result[workflow_id] = bool(allowed)
    return result


def with_withdrawal_capabilities(conn, actor, items, *, id_key="id"):
    capabilities = withdrawal_capabilities(conn, actor, [item.get(id_key) for item in items])
    return [{**item, "canWithdraw": capabilities.get(item.get(id_key), False)} for item in items]


def require_own_withdrawal(conn, actor, workflow, *, delete=False):
    if actor.get("role") == "admin":
        return
    required_status = WORKFLOW_STATUS_GENERATED if delete else WORKFLOW_STATUS_SENT
    if workflow.get("workflowStatus") != required_status or not withdrawal_capabilities(
        conn, actor, [workflow["id"]]
    ).get(workflow["id"]):
        raise PermissionError("仅可撤销本人生成或撤回本人发起且未归档的结算流程")
