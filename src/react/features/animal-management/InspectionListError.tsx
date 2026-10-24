import { ActionIcon } from "../../components/ui/ActionIcon";
import { Alert, Button } from "antd";

export function InspectionListError({ refreshing, retry }: { refreshing: boolean; retry: () => void }) {
  return (
    <Alert
      role="alert"
      title="巡检信息更新失败，暂显示上次结果"
      showIcon
      type="error"
      action={
        <Button icon={<ActionIcon name="refresh" />} loading={refreshing} onClick={retry}>
          重试
        </Button>
      }
    />
  );
}
