"""SQLite connection ownership without changing transaction semantics."""

import sqlite3


class ClosingConnection(sqlite3.Connection):
    """Commit/rollback like SQLite, then close at the outermost context exit."""

    def __enter__(self):
        result = super().__enter__()
        self._context_depth = getattr(self, "_context_depth", 0) + 1
        return result

    def __exit__(self, *exc_info):
        try:
            return super().__exit__(*exc_info)
        finally:
            self._context_depth -= 1
            if self._context_depth == 0:
                self.close()
