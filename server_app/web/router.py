import re
from collections.abc import Callable
from dataclasses import dataclass
from re import Pattern
from typing import Any

from .response import JsonResponse

RouteHandler = Callable[[Any, dict[str, str]], JsonResponse]


@dataclass(frozen=True)
class Route:
    method: str
    pattern: Pattern[str]
    handler: RouteHandler


class Router:
    def __init__(self):
        self._routes: list[Route] = []

    def add(self, method: str, path_pattern: str, handler: RouteHandler):
        self._routes.append(Route(method.upper(), re.compile(path_pattern), handler))

    def dispatch(self, method: str, path: str, context: Any):
        for route in self._routes:
            if route.method != method.upper():
                continue
            match = route.pattern.fullmatch(path)
            if match:
                return route.handler(context, match.groupdict())
        return None
