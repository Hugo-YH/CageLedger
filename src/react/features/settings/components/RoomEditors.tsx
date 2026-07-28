import type { CageRack, CageRoom } from "../../../api/contracts";
import { Button, Form, Input, Select as AntSelect } from "antd";
import { ModalShell } from "../../../components/WorkspaceUi";
import type { RoomDraft } from "../model";

const facilityOptions = [
  ["zhujiang", "珠江新城设施"],
  ["bioisland", "生物岛设施"],
];
const speciesOptions = [
  ["mouse", "小鼠"],
  ["rat", "大鼠"],
  ["guinea_pig", "豚鼠"],
  ["rabbit", "兔"],
  ["monkey", "猴"],
  ["dog", "犬"],
  ["pig", "猪"],
];
const billingOptions = [
  ["mouse_standard", "小鼠饲养费"],
  ["mouse_diabetic", "糖尿病小鼠饲养费"],
  ["rat_standard", "大鼠饲养费"],
  ["rat_diabetic", "糖尿病大鼠饲养费"],
  ["guinea_pig", "豚鼠饲养费"],
  ["rabbit", "兔饲养费"],
  ["monkey", "猴饲养费"],
  ["pig", "猪饲养费"],
  ["dog", "犬饲养费"],
];

export function RoomEditor({
  draft,
  pending,
  onChange,
  onClose,
  onSave,
}: {
  draft: RoomDraft;
  pending: boolean;
  onChange: (draft: RoomDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const update = (key: keyof RoomDraft, value: string | number) => onChange({ ...draft, [key]: value });
  return (
    <ModalShell
      ariaLabel={draft.name ? "编辑饲养间" : "新增饲养间"}
      className="settings-editor-modal"
      onClose={onClose}
    >
      <div className="modal-shell-head">
        <h2>{draft.name ? "编辑饲养间" : "新增饲养间"}</h2>
        <Button aria-label="关闭" size="small" onClick={onClose}>
          关闭
        </Button>
      </div>
      <div className="modal-shell-body form">
        <Field label="饲养间名称" value={draft.name} onChange={(value) => update("name", value)} />
        <Field label="区域" value={draft.area || ""} onChange={(value) => update("area", value)} />
        <Field label="房间管理员" value={draft.roomManager || ""} onChange={(value) => update("roomManager", value)} />
        <div className="compact-form-row half">
          <Select
            label="所属设施"
            value={draft.facility || "zhujiang"}
            options={facilityOptions}
            onChange={(value) => update("facility", value)}
          />
          <Select
            label="默认动物"
            value={draft.defaultSpecies || "mouse"}
            options={speciesOptions}
            onChange={(value) => update("defaultSpecies", value)}
          />
        </div>
        <Select
          label="默认收费项目"
          value={draft.defaultBillingItem || "mouse_standard"}
          options={billingOptions}
          onChange={(value) => update("defaultBillingItem", value)}
        />
        <div className="compact-form-row half">
          <Select
            label="默认院内/院外"
            value={draft.defaultCustomerType || "internal"}
            options={[
              ["internal", "院内"],
              ["external", "院外"],
            ]}
            onChange={(value) => update("defaultCustomerType", value)}
          />
          <Field
            label="默认每笼只数"
            type="number"
            value={String(draft.defaultAnimalCount || 1)}
            onChange={(value) => update("defaultAnimalCount", Math.max(Number(value), 1))}
          />
        </div>
      </div>
      <div className="modal-shell-actions">
        <Button onClick={onClose}>取消</Button>
        <Button disabled={pending || !draft.name.trim()} loading={pending} type="primary" onClick={onSave}>
          保存饲养间
        </Button>
      </div>
    </ModalShell>
  );
}
export function RackEditor({
  draft,
  rooms,
  pending,
  onChange,
  onClose,
  onSave,
}: {
  draft: CageRack;
  rooms: CageRoom[];
  pending: boolean;
  onChange: (draft: CageRack) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const update = (key: keyof CageRack, value: string | number) => onChange({ ...draft, [key]: value });
  return (
    <ModalShell ariaLabel="编辑笼架" className="settings-editor-modal" onClose={onClose}>
      <div className="modal-shell-head">
        <h2>编辑笼架</h2>
        <Button aria-label="关闭" size="small" onClick={onClose}>
          关闭
        </Button>
      </div>
      <div className="modal-shell-body form">
        <Form component={false} layout="vertical">
          <Form.Item label="所属饲养间">
            <AntSelect
              aria-label="所属饲养间"
              options={rooms.map((room) => ({ label: room.name, value: room.id }))}
              value={draft.roomId}
              onChange={(value) => update("roomId", value)}
            />
          </Form.Item>
        </Form>
        <div className="compact-form-row third">
          <Field
            label="笼架编号"
            type="number"
            value={String(draft.index)}
            onChange={(value) => update("index", Math.max(Number(value), 1))}
          />
          <Field
            label="行数"
            type="number"
            value={String(draft.rows)}
            onChange={(value) => update("rows", Math.max(Number(value), 1))}
          />
          <Field
            label="列数"
            type="number"
            value={String(draft.cols)}
            onChange={(value) => update("cols", Math.max(Number(value), 1))}
          />
        </div>
      </div>
      <div className="modal-shell-actions">
        <Button onClick={onClose}>取消</Button>
        <Button disabled={pending} loading={pending} type="primary" onClick={onSave}>
          保存笼架
        </Button>
      </div>
    </ModalShell>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <Form component={false} layout="vertical">
      <Form.Item label={label}>
        <Input
          aria-label={label}
          min={type === "number" ? 1 : undefined}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </Form.Item>
    </Form>
  );
}
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
}) {
  return (
    <Form component={false} layout="vertical">
      <Form.Item label={label}>
        <AntSelect
          aria-label={label}
          options={options.map(([key, text]) => ({ label: text, value: key }))}
          value={value}
          onChange={onChange}
        />
      </Form.Item>
    </Form>
  );
}
