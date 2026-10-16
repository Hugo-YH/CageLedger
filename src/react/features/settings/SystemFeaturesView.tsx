import { App, Alert, Card, Flex, Space, Switch, Typography } from "antd";
import { useEffect, useState } from "react";

import {
  DEFAULT_SYSTEM_FEATURE_FLAGS,
  SYSTEM_FEATURE_KEYS,
  type SystemFeatureFlags,
  type SystemFeatureKey,
  type SystemFeatures,
} from "../../../contracts/systemFeatures";
import { useSaveSystemFeatures, useSystemFeatures } from "../../api/systemFeatures";
import { PageSkeleton, PageState } from "../../components/WorkspaceUi";
import { ActionButton, ActionIcon, CommandBar, ListRefreshStatus } from "../../components/ui";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";

const featureDetails: Record<SystemFeatureKey, { name: string; description: string }> = {
  intake: { name: "笼卡管理", description: "预约消息识别、待接收批次和二维码扫描入口。" },
  quarantine: { name: "检疫管理", description: "检疫批次、检测和报告入口。" },
  cages: { name: "笼位管理", description: "动态笼位图和饲养间占用管理入口。" },
  animal: { name: "动物管理", description: "动物巡检、异常处置和巡检记录入口。" },
  billing: { name: "饲养费管理", description: "数量统计表录入和历史维护入口。" },
  "technical-services": { name: "技术服务费管理", description: "技术服务明细录入和历史维护入口。" },
  settlement: { name: "结算管理", description: "结算列表、单据跟踪和汇总导出入口。" },
};

function sameFlags(left: SystemFeatureFlags, right: SystemFeatureFlags) {
  return SYSTEM_FEATURE_KEYS.every((key) => left[key] === right[key]);
}

function isNewerFeatures(candidate: SystemFeatures, current: SystemFeatures | null) {
  if (!current) return true;
  if (candidate.updatedAt === current.updatedAt) return false;
  if (!candidate.updatedAt) return false;
  if (!current.updatedAt) return true;
  return candidate.updatedAt > current.updatedAt;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function SystemFeaturesView() {
  const { message } = App.useApp();
  const features = useSystemFeatures();
  const save = useSaveSystemFeatures();
  const [draft, setDraft] = useState<SystemFeatureFlags | null>(null);
  const [baseline, setBaseline] = useState<SystemFeatures | null>(null);
  const dirty = Boolean(draft && baseline && !sameFlags(draft, baseline.enabled));

  useEffect(() => {
    if (!features.data || dirty || !isNewerFeatures(features.data, baseline)) return;
    setDraft(features.data.enabled);
    setBaseline(features.data);
  }, [baseline, dirty, features.data]);

  useUnsavedChanges(dirty, save.isPending);

  const currentDraft = draft ?? features.data?.enabled ?? DEFAULT_SYSTEM_FEATURE_FLAGS;
  const enabledCount = SYSTEM_FEATURE_KEYS.filter((key) => currentDraft[key]).length;

  if (features.isPending && !features.data) {
    return (
      <section className="workspace-view settings-workspace system-features-page" data-feature="administration">
        <PageSkeleton label="系统功能" variant="form" />
      </section>
    );
  }
  if (features.isError && !features.data) {
    return (
      <section className="workspace-view settings-workspace system-features-page" data-feature="administration">
        <PageState title="系统功能加载失败" detail="请检查服务连接后重试。" retry={() => void features.refetch()} />
      </section>
    );
  }

  async function refresh() {
    await features.refetch();
    if (dirty) void message.info("已刷新服务器配置，未覆盖当前未保存的修改。");
  }
  async function saveChanges() {
    if (!baseline || !dirty) return;
    try {
      const response = await save.mutateAsync({ enabled: currentDraft, expectedUpdatedAt: baseline.updatedAt });
      setDraft(response.item.enabled);
      setBaseline(response.item);
      void message.success("系统功能设置已保存");
    } catch (error) {
      void message.error(errorMessage(error, "系统功能设置保存失败，请重试。"));
    }
  }
  function discardChanges() {
    const latest = features.data && isNewerFeatures(features.data, baseline) ? features.data : baseline;
    if (!latest) return;
    setDraft(latest.enabled);
    setBaseline(latest);
  }

  return (
    <section className="workspace-view settings-workspace system-features-page" data-feature="administration">
      <CommandBar
        ariaLabel="系统功能设置"
        title="系统功能"
        description="控制业务入口是否显示；关闭入口后，已有记录、历史数据和业务规则仍会保留。"
        context={
          <Typography.Text type="secondary">
            已启用 {enabledCount} / {SYSTEM_FEATURE_KEYS.length} 个功能
          </Typography.Text>
        }
        actions={
          <Space wrap>
            <ActionButton
              icon={<ActionIcon name="refresh" />}
              loading={features.isFetching}
              onClick={() => void refresh()}
            >
              刷新
            </ActionButton>
            {dirty ? (
              <ActionButton icon={<ActionIcon name="undo" />} disabled={save.isPending} onClick={discardChanges}>
                放弃修改
              </ActionButton>
            ) : null}
          </Space>
        }
        primaryAction={
          <ActionButton
            icon={<ActionIcon name="save" />}
            disabled={!dirty}
            loading={save.isPending}
            tone="primary"
            onClick={() => void saveChanges()}
          >
            保存设置
          </ActionButton>
        }
      />
      <div className="workspace-body settings-workspace-body">
        <ListRefreshStatus active={features.isFetching && !save.isPending} />
        {features.isError ? (
          <Alert
            showIcon
            type="error"
            title="系统功能配置更新失败，当前未保存修改已保留"
            action={
              <ActionButton
                icon={<ActionIcon name="refresh" />}
                loading={features.isFetching}
                onClick={() => void refresh()}
              >
                重试
              </ActionButton>
            }
          />
        ) : null}
        <Flex gap={12} vertical>
          {SYSTEM_FEATURE_KEYS.map((key) => {
            const feature = featureDetails[key];
            return (
              <Card key={key} size="small">
                <Flex align="center" gap={16} justify="space-between">
                  <Flex gap={4} vertical>
                    <Typography.Text strong>
                      <label className="system-feature-label" htmlFor={`system-feature-${key}`}>
                        {feature.name}
                      </label>
                    </Typography.Text>
                    <Typography.Text type="secondary">{feature.description}</Typography.Text>
                  </Flex>
                  <Switch
                    aria-label={feature.name}
                    checked={currentDraft[key]}
                    disabled={save.isPending}
                    id={`system-feature-${key}`}
                    onChange={(checked) =>
                      setDraft((previous) => ({ ...(previous ?? DEFAULT_SYSTEM_FEATURE_FLAGS), [key]: checked }))
                    }
                  />
                </Flex>
              </Card>
            );
          })}
        </Flex>
      </div>
    </section>
  );
}
