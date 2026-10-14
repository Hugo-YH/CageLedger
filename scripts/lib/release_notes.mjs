/** Parse the authoritative changelog for both app notes and Gitea Markdown. */
export function parseReleaseChangelog(source) {
  const blocks = [];
  let current;
  let fence;
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length) fence = undefined;
    }
    if (!fence && line.startsWith("## ")) {
      current = { heading: line.slice(3), lines: [] };
      blocks.push(current);
    } else if (current) current.lines.push(line);
  }
  if (fence) throw new Error("Unclosed fenced code block in wiki/更新日志.md");
  const seen = new Set();
  return blocks.map(({ heading, lines }) => {
    const match = heading.match(/^v?([^·\s（]+)(?:（([^）]+)）)?(?:\s+·\s+(.+))?\s*$/);
    if (!match) throw new Error(`Invalid release heading: ## ${heading}`);
    const version = match[1];
    if (seen.has(version)) throw new Error(`Duplicate release version in wiki/更新日志.md: ${version}`);
    seen.add(version);
    const body = lines.join("\n");
    const title = body.match(/^###[ \t]+(.+)$/m);
    if (!title?.[1].trim()) throw new Error(`Release v${version} requires a level-three title.`);
    const items = [...body.matchAll(/^-[ \t]+(.+)$/gm)].map((item) => item[1].trim()).filter(Boolean);
    if (!items.length) throw new Error(`Release v${version} requires at least one item.`);
    const note = body.match(/^>\s*备注：(.+)$/m);
    return {
      note: {
        version,
        ...(match[2] ? { build: match[2].trim().replace(/^Build\s*/i, "") } : {}),
        ...(match[3] ? { releasedAt: match[3].trim() } : {}),
        title: title[1].trim(),
        items,
        ...(note ? { note: note[1].trim() } : {}),
      },
      body: `## ${heading.trim()}\n\n${body.trim()}`,
    };
  });
}

export function releasePayloads(source, version, name) {
  if (!/^\d+\.\d+\.\d+[0-9A-Za-z.-]*$/.test(version)) throw new Error("Invalid release version");
  const entry = parseReleaseChangelog(source).find(({ note }) => note.version === version);
  if (!entry) throw new Error(`wiki/更新日志.md is missing release notes for ${version}`);
  const displayName = name || `${version}${entry.note.build ? `（Build ${entry.note.build}）` : ""}`;
  const update = { name: displayName, body: entry.body };
  return { create: { tag_name: `v${version}`, ...update, draft: true }, update };
}

export function verifyReleaseBody(release, expected) {
  if (!expected.body?.trim() || release.tag_name !== expected.tag_name)
    throw new Error("Gitea Release notes validation failed: missing notes or wrong tag");
  const actual = typeof release.body === "string" ? release.body.replace(/\r\n/g, "\n").trim() : "";
  if (actual !== expected.body.trim())
    throw new Error(`Gitea Release ${expected.tag_name} body differs from wiki/更新日志.md`);
}
