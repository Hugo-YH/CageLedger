import { Button, Drawer, Form, Input, InputNumber, Popconfirm, Space, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";

import { formValuesToNode, nodeToFormValues } from "../../../domain/inspectionCatalog";
import type { InspectionNodeFormValues } from "../../../domain/inspectionCatalog";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import type { InspectionCatalogNode } from "../../api/contracts";
import { InspectionReferenceImages } from "./InspectionReferenceImages";

export function InspectionNodeForm({
  node,
  isNew,
  onSave,
  onClose,
  onDelete,
}: {
  node: InspectionCatalogNode;
  isNew: boolean;
  onSave: (node: InspectionCatalogNode) => void;
  onClose: () => void;
  onDelete?: (code: string) => void;
}) {
  const isMobile = useIsMobileLayout();
  const [form] = Form.useForm<InspectionNodeFormValues>();
  const initialValues = nodeToFormValues(node);
  const showItemSections = node.nodeType === "ITEM";

  return (
    <Drawer
      className="inspection-node-drawer"
      open
      onClose={onClose}
      size={isMobile ? "100%" : 640}
      destroyOnClose
      title={
        <Space>
          <Typography.Text strong>{isNew ? "新增条目" : node.name}</Typography.Text>
          <Tag color={isNew ? "green" : "blue"}>{node.nodeType}</Tag>
        </Space>
      }
      footer={
        <div className="inspection-node-drawer-footer">
          {onDelete && !isNew && node.nodeType === "ITEM" ? (
            <Popconfirm
              title="删除该条目？"
              description="删除仅影响未发布的草稿，发布后生效。"
              okText="删除"
              okButtonProps={{ danger: true }}
              onConfirm={() => onDelete(node.code)}
            >
              <Button danger icon={<DeleteOutlined />}>
                删除条目
              </Button>
            </Popconfirm>
          ) : (
            <span />
          )}
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" form="inspection-node-form" icon={<SaveOutlined />}>
              保存修改
            </Button>
          </Space>
        </div>
      }
    >
      <Form
        id="inspection-node-form"
        form={form}
        className="inspection-node-form"
        layout="vertical"
        initialValues={initialValues}
        onFinish={(values) => onSave(formValuesToNode(values, node))}
      >
        <Form.Item name="code" label="条目编号" tooltip="编号由所属分类自动生成，不可修改">
          <Input disabled />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
          <Input maxLength={80} />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} maxLength={300} />
        </Form.Item>
        <Form.Item name="sortOrder" label="排序" tooltip="数值越小越靠前">
          <InputNumber min={0} max={9999} style={{ width: 120 }} />
        </Form.Item>
        {showItemSections ? (
          <>
            <Form.Item name="suggestionMeasure" label="处置建议">
              <Input.TextArea rows={2} maxLength={300} />
            </Form.Item>
            <Form.Item name="referenceImages" label="参考图" tooltip="上传后立即保存到服务器，随草稿一起发布">
              <InspectionReferenceImages />
            </Form.Item>
            <Typography.Text type="secondary" className="inspection-binary-hint">
              巡检录入按「正常 / 异常」判定，无需配置评分；异常类型用于异常确认时选择具体表现。
            </Typography.Text>
            <Form.List name="subOptions">
              {(fields, { add, remove }) => (
                <div className="inspection-form-section">
                  <div className="inspection-form-section-head">
                    <Typography.Text strong>异常类型选项</Typography.Text>
                    <Button
                      size="small"
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={() => add({ id: "", nameCn: "" })}
                    >
                      添加选项
                    </Button>
                  </div>
                  {fields.length === 0 ? (
                    <Typography.Text type="secondary">无异常类型选项，异常确认时无需选择。</Typography.Text>
                  ) : null}
                  {fields.map((field) => (
                    <div className="inspection-suboption-row" key={field.key}>
                      <Form.Item name={[field.name, "id"]} rules={[{ required: true, message: "标识" }]}>
                        <Input placeholder="标识，如：pale" style={{ width: 120 }} />
                      </Form.Item>
                      <Form.Item name={[field.name, "nameCn"]} rules={[{ required: true, message: "名称" }]}>
                        <Input placeholder="中文名，如：苍白" style={{ width: 140 }} />
                      </Form.Item>
                      <Form.Item name={[field.name, "nameEn"]}>
                        <Input placeholder="英文名（可选）" style={{ width: 140 }} />
                      </Form.Item>
                      <Button
                        className="inspection-scoring-remove"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Form.List>
          </>
        ) : null}
      </Form>
    </Drawer>
  );
}
