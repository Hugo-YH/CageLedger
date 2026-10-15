"""Assemble domain route declarations without loading handlers or the database."""

from server_app.web.route_definitions import operations, platform, settlement, support

ROUTE_GROUPS = {**settlement.ROUTE_GROUPS, **support.ROUTE_GROUPS, **operations.ROUTE_GROUPS, **platform.ROUTE_GROUPS}
