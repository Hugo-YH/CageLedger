import { Collapse, Typography } from "antd";

/** Local result details survive until the next action; never automatically replay a write. */
export function BatchFailureDetails({ failures }: { failures: string[] }) {
  if (!failures.length) return null;
  return (
    <Collapse
      size="small"
      ghost
      defaultActiveKey={failures.length <= 3 ? ["failures"] : []}
      items={[
        {
          key: "failures",
          label: `${failures.length} 项失败原因 · 核对后再确认操作`,
          children: (
            <ul>
              {failures.map((failure, index) => (
                <li key={index}>
                  <Typography.Text>{failure}</Typography.Text>
                </li>
              ))}
            </ul>
          ),
        },
      ]}
    />
  );
}
