import { CalendarOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { Button, Flex, Modal, Space, Tag, Typography } from "antd";
import { useRef, useState } from "react";

import { useAcknowledgeReleaseAnnouncement, useReleaseAnnouncement } from "../../api/administration";
import { SYSTEM_RELEASE_NOTES } from "../../releaseNotes";
import { APP_VERSION } from "../../version";

const CURRENT_RELEASE_NOTE = SYSTEM_RELEASE_NOTES.find((note) => note.version === APP_VERSION);

export function ReleaseAnnouncementModal() {
  const note = CURRENT_RELEASE_NOTE;
  const status = useReleaseAnnouncement(note?.version || "", Boolean(note));
  const acknowledgement = useAcknowledgeReleaseAnnouncement(note?.version || "");
  const [dismissed, setDismissed] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const open = Boolean(note && status.data && !status.data.acknowledged && !dismissed);

  if (!note) return null;

  function acknowledge() {
    setDismissed(true);
    acknowledgement.mutate();
  }

  function openFullReleaseNotes() {
    setDismissed(true);
    acknowledgement.mutate(undefined, {
      onSettled: () => window.location.assign("/docs/releases/"),
    });
  }

  return (
    <Modal
      afterOpenChange={(isOpen) => {
        if (isOpen) confirmButtonRef.current?.focus();
      }}
      centered
      className="release-announcement-modal"
      destroyOnHidden
      footer={
        <Flex gap={8} justify="end" wrap>
          <Button onClick={openFullReleaseNotes}>查看完整更新记录</Button>
          <Button ref={confirmButtonRef} type="primary" onClick={acknowledge}>
            我知道了
          </Button>
        </Flex>
      }
      mask={{ closable: false }}
      open={open}
      title={`CageLedger ${note.version} 已更新`}
      width={600}
      onCancel={acknowledge}
    >
      <div className="release-announcement-content" data-ui="release-announcement">
        <Space size={8} wrap>
          {note.build ? <Tag color="blue">Build {note.build}</Tag> : null}
          {note.releasedAt ? (
            <Typography.Text type="secondary">
              <CalendarOutlined aria-hidden /> {note.releasedAt}
            </Typography.Text>
          ) : null}
        </Space>
        <Typography.Title level={3}>{note.title}</Typography.Title>
        <ul className="release-announcement-items">
          {note.items.map((item) => (
            <li key={item}>
              <CheckCircleOutlined aria-hidden />
              <Typography.Text>{item}</Typography.Text>
            </li>
          ))}
        </ul>
        {note.note || note.notes ? (
          <Typography.Paragraph className="release-announcement-note" type="secondary">
            {note.note || note.notes}
          </Typography.Paragraph>
        ) : null}
      </div>
    </Modal>
  );
}
