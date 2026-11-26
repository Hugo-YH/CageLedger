import { CloseOutlined } from "@ant-design/icons";
import { Card, Flex, Typography, theme } from "antd";
import { useEffect, useRef, type ComponentProps, type CSSProperties } from "react";
import { ActionButton } from "../../../components/ui";
import { VirtualRack } from "./CageWorkspaceComponents";

export function RoomRackDetails({
  onClose,
  focusOnOpen,
  ...rackProps
}: ComponentProps<typeof VirtualRack> & { onClose: () => void; focusOnOpen: boolean }) {
  const panel = useRef<HTMLElement>(null);
  const { token } = theme.useToken();
  const { rack, slots } = rackProps;

  useEffect(() => {
    if (focusOnOpen) panel.current?.focus();
  }, [focusOnOpen]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        !(event.target instanceof Node) ||
        !panel.current?.contains(event.target)
      )
        return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <section
      aria-label={`${rack.name} 笼位详情`}
      className="cage-rack-detail"
      ref={panel}
      tabIndex={-1}
      style={{ "--cage-rack-detail-columns": Math.max(1, rack.cols) } as CSSProperties}
    >
      <Card
        title={
          <h4 className="cage-room-panel-title" title={rack.name}>
            {rack.name} · 笼位
          </h4>
        }
        extra={
          <Flex align="center" gap={8}>
            <Typography.Text type="secondary">{slots.length} 个笼位</Typography.Text>
            <ActionButton
              className="cage-rack-detail-close"
              aria-label="关闭笼位详情"
              title="关闭笼位详情"
              tone="tertiary"
              icon={<CloseOutlined aria-hidden />}
              onClick={onClose}
            >
              关闭
            </ActionButton>
          </Flex>
        }
        styles={{ body: { padding: token.paddingSM } }}
      >
        <VirtualRack {...rackProps} />
      </Card>
    </section>
  );
}
