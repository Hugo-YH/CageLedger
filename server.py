#!/usr/bin/env python3

from server_app import legacy as _legacy
from server_app.domains import administration as _administration
from server_app.domains import billing as _billing
from server_app.domains import cages as _cages
from server_app.domains import iacuc as _iacuc
from server_app.domains import intake as _intake
from server_app.domains import quantity as _quantity
from server_app.domains import reimbursement as _reimbursement
from server_app.domains import workflow as _workflow

main = _legacy.main
_COMPATIBILITY_MODULES = (
    _legacy,
    _administration,
    _billing,
    _cages,
    _iacuc,
    _intake,
    _quantity,
    _reimbursement,
    _workflow,
)


def __getattr__(name):
    # Preserve imports used by existing integrations while domains move out of legacy.py.
    for module in _COMPATIBILITY_MODULES:
        if hasattr(module, name):
            return getattr(module, name)
    raise AttributeError(name)


if __name__ == "__main__":
    main()
