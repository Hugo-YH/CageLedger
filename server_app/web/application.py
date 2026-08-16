#!/usr/bin/env python3

try:
    import openpyxl
except ImportError:
    openpyxl = None


from server_app.web import CageLedgerHttpHandler
from server_app.web.handler_support import HandlerSupportMixin
from server_app.web.read_routes import ReadRoutesMixin
from server_app.web.reimbursement_actions import ReimbursementActionsMixin
from server_app.web.workflow_actions import WorkflowActionsMixin
from server_app.web.write_routes import WriteRoutesMixin


class CageLedgerHandler(
    ReadRoutesMixin,
    WriteRoutesMixin,
    WorkflowActionsMixin,
    ReimbursementActionsMixin,
    HandlerSupportMixin,
    CageLedgerHttpHandler,
):
    server_version = "CageLedger/0.2"
