"""Bounded, content-addressed projections of already validated archive rows."""

from collections import Counter, OrderedDict
from threading import RLock


class BoundedCache:
    def __init__(self, entries, budget):
        self.entries, self.budget = entries, budget
        self.values = OrderedDict()
        self.bytes = 0
        self.lock = RLock()

    def get(self, key):
        with self.lock:
            entry = self.values.get(key)
            if entry is not None:
                self.values.move_to_end(key)
                return entry[0]
        return None

    def put(self, key, value, size):
        if size > self.budget:
            return value
        with self.lock:
            prior = self.values.pop(key, None)
            if prior is not None:
                self.bytes -= prior[1]
            self.values[key] = (value, size)
            self.bytes += size
            while len(self.values) > self.entries or self.bytes > self.budget:
                _, (_, removed) = self.values.popitem(last=False)
                self.bytes -= removed
        return value


REPORTS = BoundedCache(4, 32 * 1024 * 1024)
METADATA = BoundedCache(128, 2 * 1024 * 1024)


class Archive(dict):
    """Private parsed input; public responses only receive copied projections."""

    def __init__(self, value, key):
        super().__init__(value)
        self.key = key
        self.by_id = {item["id"]: item for item in value["findings"]}
        self.groups = Counter((item["code"], item["reviewStatus"]) for item in value["findings"])
        self.orders = {}
        self.views = OrderedDict()
        self.lock = RLock()

    def selected(self, filters, sort_key, direction):
        codes = frozenset(filters.get("code", []))
        statuses = frozenset(filters.get("reviewStatus", []))
        order_key = (sort_key, direction if sort_key else "asc")
        key = (*order_key, codes, statuses)
        with self.lock:
            if key in self.views:
                self.views.move_to_end(key)
                return self.views[key]
            if ("", "asc") not in self.orders:
                self.orders["", "asc"] = sorted(
                    self["findings"],
                    key=lambda item: (item["reviewStatus"] != "needs_review", item["code"], item["id"]),
                )
            if order_key not in self.orders:
                self.orders[order_key] = sorted(
                    self.orders["", "asc"], key=lambda item: item[sort_key], reverse=direction == "desc"
                )
            result = tuple(
                item
                for item in self.orders[order_key]
                if (not codes or item["code"] in codes) and (not statuses or item["reviewStatus"] in statuses)
            )
            self.views[key] = result
            if len(self.views) > 8:
                self.views.popitem(last=False)
            return result
