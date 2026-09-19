import { CalendarOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Flex, Modal, Space, Tag, Typography } from "antd";
import { useRef, useState } from "react";

import { useAcknowledgeReleaseAnnouncements, useReleaseAnnouncementHistory } from "../../api/administration";
import { SYSTEM_RELEASE_NOTES } from "../../releaseNotes";
import { APP_VERSION } from "../../version";
import { unreadReleaseNotes } from "./releaseAnnouncementModel";

export function ReleaseAnnouncementModal() {
  const status = useReleaseAnnouncementHistory();
  const acknowledgement = useAcknowledgeReleaseAnnouncements();
  const notes = status.data
    ? unreadReleaseNotes(SYSTEM_RELEASE_NOTES, APP_VERSION, status.data.acknowledgedVersions)
    : [];
  const [dismissed, setDismissed] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const open = notes.length > 0 && !dismissed;

  function acknowledge(showHistory = false) {
    if (submitting.current || !notes.length) return;
    submitting.current = true;
    // Submit only the versions in this dialog; an update in another tab is not implicitly read.
    acknowledgement.mutate(
      notes.map((note) => note.version),
      {
        onSuccess: () => {
          setDismissed(true);
          if (showHistory) window.location.assign("/docs/releases/");
        },
        onSettled: () => {
          submitting.current = false;
        },
      },
    );
  }

  return (
    <Modal
      afterOpenChange={(isOpen) => {
        if (isOpen) confirmButtonRef.current?.focus();
      }}
      centered
      className="app-modal-root release-announcement-modal"
      closable={!acknowledgement.isPending}
      destroyOnHidden
      footer={
        <Flex gap={8} justify="end" wrap>
          <Button disabled={acknowledgement.isPending} onClick={() => acknowledge(true)}>
            查看完整更新记录
          </Button>
          <Button
            ref={confirmButtonRef}
            type="primary"
            loading={acknowledgement.isPending}
            onClick={() => acknowledge()}
          >
            我知道了
          </Button>
        </Flex>
      }
      keyboard={!acknowledgement.isPending}
      mask={{ closable: false }}
      open={open}
      title="系统更新"
      width={600}
      onCancel={() => acknowledge()}
    >
      <Flex vertical gap={16} data-ui="release-announcement">
        {acknowledgement.isError ? <Alert type="error" showIcon title="确认未成功，请重试。" /> : null}
        <Collapse
          key={notes.map((note) => note.version).join(",")}
          defaultActiveKey={notes
            .filter((note, index) => notes.length <= 3 || note.version.endsWith(".0") || index === notes.length - 1)
            .map((note) => note.version)}
          items={notes.map((note) => ({
            key: note.version,
            label: (
              <Typography.Text strong>
                {note.version} · {note.title}
              </Typography.Text>
            ),
            children: (
              <Flex vertical gap={16}>
                <Space size={8} wrap>
                  {note.build ? <Tag color="blue">Build {note.build}</Tag> : null}
                  {note.releasedAt ? (
                    <Typography.Text type="secondary">
                      <CalendarOutlined aria-hidden /> {note.releasedAt}
                    </Typography.Text>
                  ) : null}
                </Space>
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
              </Flex>
            ),
          }))}
        />
      </Flex>
    </Modal>
  );
}
