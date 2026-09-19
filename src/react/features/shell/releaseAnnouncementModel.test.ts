import { describe, expect, it } from "vitest";
import type { ReleaseNote } from "../../releaseNoteModel";
import { unreadReleaseNotes } from "./releaseAnnouncementModel";

const notes: ReleaseNote[] = ["1.3.2", "1.3.1", "1.3.0", "1.2.10", "1.2.9"].map((version) => ({
  version,
  title: version,
  items: [],
}));
const versions = (seen: string[], current = "1.3.1") =>
  unreadReleaseNotes(notes, current, seen).map((note) => note.version);

describe("unread release announcements", () => {
  it("shows beta and rc updates and orders candidates before the stable release", () => {
    const prereleases = ["1.4.0", "1.4.0-rc2", "1.4.0-rc1", "1.4.0-beta10", "1.4.0-beta2"].map((version) => ({
      version,
      title: version,
      items: [],
    }));
    expect(unreadReleaseNotes(prereleases, "1.4.0-rc2", ["1.4.0-beta2"]).map((note) => note.version)).toEqual([
      "1.4.0-beta10",
      "1.4.0-rc1",
      "1.4.0-rc2",
    ]);
    expect(unreadReleaseNotes(prereleases, "1.4.0-beta2", []).map((note) => note.version)).toEqual(["1.4.0-beta2"]);
    expect(unreadReleaseNotes(prereleases, "1.4.0", ["1.4.0-rc2"]).map((note) => note.version)).toEqual(["1.4.0"]);
  });

  it("keeps the missed major release together with the later patch in chronological order", () => {
    expect(versions(["1.2.10"])).toEqual(["1.3.0", "1.3.1"]);
  });

  it("compares numeric version components rather than text", () => {
    expect(versions(["1.2.9"])).toEqual(["1.2.10", "1.3.0", "1.3.1"]);
  });

  it("only shows the current release for an account without a confirmation baseline", () => {
    expect(versions([])).toEqual(["1.3.1"]);
    expect(versions(["invalid-legacy-id"])).toEqual(["1.3.1"]);
  });

  it("uses persisted legacy confirmations even when the baseline has left the release catalog", () => {
    expect(versions(["1.2.8"])).toEqual(["1.2.9", "1.2.10", "1.3.0", "1.3.1"]);
  });

  it("does not redisplay earlier releases after confirming the current release", () => {
    expect(versions(["1.3.1"])).toEqual([]);
    expect(versions(["1.2.9", "1.3.0", "1.2.10"])).toEqual(["1.3.1"]);
  });

  it("does not display future notes or regress reading progress after a server rollback", () => {
    expect(versions(["1.2.10"])).not.toContain("1.3.2");
    expect(versions(["1.3.2"])).toEqual([]);
  });

  it("does not invent content for a missing current release or invalid version", () => {
    expect(versions([], "2.0.0")).toEqual([]);
    expect(versions([], "invalid")).toEqual([]);
    expect(unreadReleaseNotes([...notes, { version: "invalid", title: "", items: [] }], "1.3.1", ["1.3.0"])).toEqual([
      notes[1],
    ]);
  });
});
