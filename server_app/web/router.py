import re
from collections.abc import Callable
from dataclasses import dataclass
from re import Pattern
from typing import Any

from .response import JsonResponse

RouteHandler = Callable[[Any, dict[str, str]], JsonResponse]
RouteMatcher = Callable[[Any, str], dict[str, Any] | None]
HANDLED = object()


@dataclass(frozen=True)
class Route:
    method: str
    pattern: Pattern[str] | None
    handler: Callable
    matcher: RouteMatcher | None = None
    paths: tuple[str, ...] = ()


class Router:
    def __init__(self):
        self._routes: list[Route] = []

    def add(self, method: str, path_pattern: str, handler: RouteHandler):
        template = re.sub(r"\(\?P<(\w+)>[^)]*\)", lambda match: "{" + match[1] + "}", path_pattern)
        self._routes.append(Route(method.upper(), re.compile(path_pattern), handler, paths=(template,)))

    def add_handled(self, method: str, matcher: RouteMatcher, handler: Callable, *, paths=()):
        """Register an existing HTTP action that sends its own response."""
        self._routes.append(Route(method.upper(), None, handler, matcher, tuple(paths)))

    def registered_paths(self):
        return [(route.method, path) for route in self._routes for path in route.paths]

    def dispatch(self, method: str, path: str, context: Any):
        for route in self._routes:
            if route.method != method.upper():
                continue
            if route.matcher:
                params = route.matcher(context, path)
            else:
                match = route.pattern.fullmatch(path)
                params = match.groupdict() if match else None
            if params is not None:
                response = route.handler(context, params)
                if response is not None or route.matcher is None:
                    return response
        return None

    def handle(self, method: str, path: str, context: Any) -> bool:
        response = self.dispatch(method, path, context)
        if response is None:
            return False
        if isinstance(response, JsonResponse):
            context.send_json(response.payload, response.status)
        return True
