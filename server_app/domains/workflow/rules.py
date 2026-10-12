"""Business stages keep their legacy stored codes for existing documents."""

from .constants import WORKFLOW_STATUS_ARCHIVED, WORKFLOW_STATUS_SENT


def unlock_status(statement):
    previous = statement.get("lockedFromStatus")
    if previous in (WORKFLOW_STATUS_SENT, WORKFLOW_STATUS_ARCHIVED):
        return previous
    return WORKFLOW_STATUS_SENT if statement.get("signedStatementReturned") is False else WORKFLOW_STATUS_ARCHIVED
