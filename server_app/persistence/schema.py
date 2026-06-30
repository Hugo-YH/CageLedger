from collections.abc import Callable, Iterable
from dataclasses import dataclass
from sqlite3 import Connection


@dataclass(frozen=True)
class SchemaStep:
    name: str
    apply: Callable[[Connection], None]


class SchemaRegistry:
    def __init__(self, steps: Iterable[SchemaStep] = ()):
        self._steps = list(steps)
        self._validate_names()

    def register(self, name: str, apply: Callable[[Connection], None]):
        self._steps.append(SchemaStep(name, apply))
        self._validate_names()

    def apply(self, conn: Connection):
        for step in self._steps:
            step.apply(conn)

    def names(self):
        return tuple(step.name for step in self._steps)

    def _validate_names(self):
        names = [step.name for step in self._steps]
        if len(names) != len(set(names)):
            raise ValueError("Schema step names must be unique")
