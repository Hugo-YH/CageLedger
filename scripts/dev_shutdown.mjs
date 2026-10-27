// Operate on ChildProcess handles owned by this launcher, never on process names.
export function childExitCode(code, signal) {
  if (signal === "SIGINT" || signal === "SIGTERM") return 0;
  if (signal) return 1;
  return code ?? 0;
}

export function createDevShutdown(processes, cleanup, exit, { forceAfterMs = 15_000 } = {}) {
  let stopping;
  return (code = 0) => {
    if (stopping) return stopping;
    stopping = (async () => {
      const children = [...processes];
      const exited = children.map(
        (child) =>
          new Promise((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) resolve();
            else child.once("exit", resolve);
          }),
      );
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      }
      const forceTimer = setTimeout(() => {
        for (const child of children) {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
      }, forceAfterMs);
      try {
        await Promise.all(exited);
      } finally {
        clearTimeout(forceTimer);
      }
      cleanup();
      exit(code);
    })();
    return stopping;
  };
}
