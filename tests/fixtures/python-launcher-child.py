"""Owned subprocess fixture for launcher signal/exit integration tests."""

import signal
import sys
import time
from threading import Event

stopping = Event()


def stop(name, _frame):
    print(f"SIGNAL {signal.Signals(name).name}", flush=True)
    stopping.set()


for name in (signal.SIGTERM, signal.SIGINT):
    signal.signal(name, stop)
print("READY", flush=True)
if len(sys.argv) > 1:
    sys.exit(int(sys.argv[1]))
stopping.wait(5)
time.sleep(0.2)
print("CLOSED", flush=True)
