"""Run explicit unittest targets and reject an accidentally empty selection."""

import argparse
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def run_targets(targets):
    if not targets:
        raise ValueError("必须指定 Python 测试模块、类或方法。")
    suite = unittest.defaultTestLoader.loadTestsFromNames(targets)
    if suite.countTestCases() == 0:
        raise ValueError("所选目标没有测试用例，未执行任何验证。")
    return unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("targets", nargs="+")
    try:
        raise SystemExit(0 if run_targets(parser.parse_args().targets) else 1)
    except ValueError as error:
        raise SystemExit(str(error)) from error
