"""Two upstream requests at most; merge only identical requests that are still running."""

import copy
import threading
from concurrent.futures import Future, TimeoutError

from server_app.config import DEEPSEEK_TIMEOUT_SECONDS

from .recognition_uploads import RecognitionBusy


class RecognitionJobs:
    def __init__(self, *, capacity=2, max_waiters=2, timeout=DEEPSEEK_TIMEOUT_SECONDS + 5):
        self.capacity, self.max_waiters, self.timeout = capacity, max_waiters, timeout
        self.lock = threading.Lock()
        self.flights = {}
        self.waiters = 0

    def run(self, key, operation):
        with self.lock:
            future = self.flights.get(key)
            owner = future is None
            if owner:
                if len(self.flights) >= self.capacity:
                    raise RecognitionBusy("预约识别繁忙，请稍后重试；当前草稿已保留")
                future = self.flights[key] = Future()
            else:
                if self.waiters >= self.max_waiters:
                    raise RecognitionBusy("预约识别繁忙，请稍后重试；当前草稿已保留")
                self.waiters += 1
        if owner:
            try:
                future.set_result(operation())
            except BaseException as error:
                future.set_exception(error)
            finally:
                with self.lock:
                    del self.flights[key]
        try:
            return copy.deepcopy(future.result(timeout=self.timeout))
        except TimeoutError as error:
            raise ValueError("等待预约识别超时，请稍后重试") from error
        finally:
            if not owner:
                with self.lock:
                    self.waiters -= 1


JOBS = RecognitionJobs()
