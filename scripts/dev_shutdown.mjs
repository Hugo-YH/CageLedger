// Operate on ChildProcess handles owned by this launcher, never on process names.
export function createDevShutdown(processes, cleanup, exit) {
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
      await Promise.all(exited);
      cleanup();
      exit(code);
    })();
    return stopping;
  };
}
