#!/usr/bin/env python3

from server_app import legacy as _legacy

main = _legacy.main


def __getattr__(name):
    # Preserve imports used by existing integrations while domains move out of legacy.py.
    return getattr(_legacy, name)


if __name__ == "__main__":
    main()
