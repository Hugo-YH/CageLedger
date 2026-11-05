import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HELPER = Path(__file__).resolve().parents[1] / "scripts/docker_local.sh"


class LocalDockerTests(unittest.TestCase):
    def invoke(self, system, endpoint, selectors=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "uname").write_text(f"#!/bin/sh\necho {system}\n")
            (root / "uname").chmod(0o755)
            (root / "docker").write_text(
                f"#!{sys.executable}\nimport os,sys,json\na=sys.argv[1:]\n"
                "if a[:2]==['context','show']:print('colima')\n"
                "elif a[:2]==['context','inspect']:print(os.environ['MOCK_ENDPOINT'])\n"
                "else:print(json.dumps({'arguments':a,'context':os.environ.get('DOCKER_CONTEXT'),'host':os.environ.get('DOCKER_HOST')}))\n"
            )
            (root / "docker").chmod(0o755)
            env = {k: v for k, v in os.environ.items() if not k.startswith("DOCKER_")}
            env.update(PATH=str(root) + os.pathsep + os.environ["PATH"], MOCK_ENDPOINT=endpoint)
            env.update(selectors or {})
            return subprocess.run(
                ["bash", "-c", 'source "$1"; docker_local info', "test", str(HELPER)],
                env=env,
                capture_output=True,
                text=True,
            )

    def test_mac_preserves_local_colima_and_rejects_remote_host(self):
        result = self.invoke(
            "Darwin", "unix:///Users/example/.colima/default/docker.sock", {"DOCKER_CONTEXT": "colima"}
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["context"], "colima")
        result = self.invoke("Darwin", "ssh://remote.example", {"DOCKER_HOST": "ssh://remote.example"})
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("arguments", result.stdout)

    def test_linux_uses_managed_socket_instead_of_inherited_remote(self):
        result = self.invoke(
            "Linux", "unused", {"DOCKER_CONTEXT": "remote", "DOCKER_HOST": "tcp://remote.example:2375"}
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["arguments"], ["--host=unix:///var/run/docker.sock", "info"])
        self.assertIsNone(value["context"])
        self.assertIsNone(value["host"])
