"""Actor-specific withdrawal capabilities, projected after shared response caches."""

from .constants import WORKFLOW_STATUS_ARCHIVED, WORKFLOW_STATUS_GENERATED, WORKFLOW_STATUS_LOCKED, WORKFLOW_STATUS_SENT
from .repository import list_workflow_handlers, unlock_targets


def withdrawal_capabilities(conn, actor, workflow_ids):
    statuses, handled = list_workflow_handlers(
        conn, workflow_ids, actor.get("id") if actor.get("role") == "room_admin" else None
    )
    actor_id = actor.get("id")
    result = {}
    for workflow_id, status in statuses.items():
        if actor.get("role") == "admin" or actor.get("billingLockAllowed"):
            allowed = status in (WORKFLOW_STATUS_GENERATED, WORKFLOW_STATUS_SENT, WORKFLOW_STATUS_ARCHIVED)
        else:
            allowed = (
                actor.get("role") == "room_admin"
                and status in (WORKFLOW_STATUS_GENERATED, WORKFLOW_STATUS_SENT, WORKFLOW_STATUS_ARCHIVED)
                and bool(actor_id)
                and workflow_id in handled
            )
        result[workflow_id] = bool(allowed)
    return result


def with_withdrawal_capabilities(conn, actor, items, *, id_key="id"):
    capabilities = withdrawal_capabilities(conn, actor, [item.get(id_key) for item in items])
    archive_targets = unlock_targets(
        conn,
        [
            item.get(id_key)
            for item in items
            if item.get("workflowStatus") == WORKFLOW_STATUS_LOCKED and item.get(id_key)
        ],
    )
    return [
        {
            **item,
            "canWithdraw": capabilities.get(item.get(id_key), False),
            **({"unlockStatus": archive_targets[item[id_key]]} if item.get(id_key) in archive_targets else {}),
        }
        for item in items
    ]


def require_workflow_withdrawal(conn, actor, workflow, *, delete=False, to_status=None):
    if actor.get("role") == "admin":
        return
    status = workflow.get("workflowStatus")
    action_allowed = (
        status == WORKFLOW_STATUS_GENERATED
        if delete
        else (status, to_status)
        in {
            (WORKFLOW_STATUS_SENT, WORKFLOW_STATUS_GENERATED),
            (WORKFLOW_STATUS_ARCHIVED, WORKFLOW_STATUS_SENT),
        }
    )
    if not action_allowed or not withdrawal_capabilities(conn, actor, [workflow["id"]]).get(workflow["id"]):
        raise PermissionError("仅经手人或有结算锁定授权的账号可撤回未归档的结算流程；已归档流程须先解锁")
