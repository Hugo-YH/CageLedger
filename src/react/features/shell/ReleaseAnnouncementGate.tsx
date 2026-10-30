import { lazy, Suspense } from "react";

import { useReleaseAnnouncementHistory } from "../../api/administration";
import { ModalPresence } from "../../components/ui/ModalPresence";
import { RELEASE_NOTE_VERSIONS } from "../../releaseNotesVersions";
import { APP_VERSION } from "../../version";
import { unreadReleaseNotes } from "./releaseAnnouncementModel";

const ReleaseAnnouncementModal = lazy(() =>
  import("./ReleaseAnnouncementModal").then((module) => ({ default: module.ReleaseAnnouncementModal })),
);
const versions = RELEASE_NOTE_VERSIONS.map((version) => ({ version }));

export function ReleaseAnnouncementGate({ actorId }: { actorId: string }) {
  const status = useReleaseAnnouncementHistory(actorId);
  const unread = status.data && unreadReleaseNotes(versions, APP_VERSION, status.data.acknowledgedVersions).length > 0;
  return (
    <Suspense fallback={null}>
      <ModalPresence>{unread ? <ReleaseAnnouncementModal actorId={actorId} /> : null}</ModalPresence>
    </Suspense>
  );
}
