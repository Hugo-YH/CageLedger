"""Bounded in-process throttling for repeated login failures."""

import hashlib
import math
import threading
import time

from server_app.config import LOGIN_FAILURE_LIMIT, LOGIN_FAILURE_WINDOW_SECONDS, LOGIN_IP_FAILURE_LIMIT


class LoginThrottle:
    def __init__(
        self,
        account_limit=LOGIN_FAILURE_LIMIT,
        ip_limit=LOGIN_IP_FAILURE_LIMIT,
        window_seconds=LOGIN_FAILURE_WINDOW_SECONDS,
        max_keys=4096,
        clock=time.monotonic,
    ):
        self.account_limit = account_limit
        self.ip_limit = ip_limit
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self.clock = clock
        self._lock = threading.Lock()
        self._attempts = {}

    def retry_after(self, ip_address, username):
        now = self.clock()
        with self._lock:
            account = self._active(self._account_key(ip_address, username), now)
            address = self._active(self._ip_key(ip_address), now)
            waits = []
            if len(account) >= self.account_limit:
                waits.append(account[0] + self.window_seconds - now)
            if len(address) >= self.ip_limit:
                waits.append(address[0] + self.window_seconds - now)
            return max(1, math.ceil(max(waits))) if waits else 0

    def record_failure(self, ip_address, username):
        now = self.clock()
        with self._lock:
            self._append(self._account_key(ip_address, username), now)
            self._append(self._ip_key(ip_address), now)
            self._prune_capacity(now)

    def clear_account(self, ip_address, username):
        with self._lock:
            self._attempts.pop(self._account_key(ip_address, username), None)

    def _active(self, key, now):
        attempts = self._attempts.get(key, [])
        active = [value for value in attempts if value + self.window_seconds > now]
        if active:
            self._attempts[key] = active
        else:
            self._attempts.pop(key, None)
        return active

    def _append(self, key, now):
        attempts = self._active(key, now)
        attempts.append(now)
        self._attempts[key] = attempts

    def _prune_capacity(self, now):
        if len(self._attempts) <= self.max_keys:
            return
        for key in list(self._attempts):
            self._active(key, now)
        while len(self._attempts) > self.max_keys:
            oldest = min(self._attempts, key=lambda key: self._attempts[key][-1])
            self._attempts.pop(oldest, None)

    @staticmethod
    def _account_key(ip_address, username):
        digest = hashlib.sha256(str(username).strip().casefold().encode("utf-8")).hexdigest()
        return f"account:{ip_address}:{digest}"

    @staticmethod
    def _ip_key(ip_address):
        return f"ip:{ip_address}"


LOGIN_THROTTLE = LoginThrottle()
