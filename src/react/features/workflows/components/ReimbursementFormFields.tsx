import { InfoCircleOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Form, Input, InputNumber, Tooltip, type AutoCompleteProps } from "antd";

/** Shared by return registration and later reimbursement recording. */
export function ReimbursementFormFields({
  options,
  loading,
}: {
  options: AutoCompleteProps["options"];
  loading: boolean;
}) {
  return (
    <div className="workflow-reimbursement-fields">
      <Form.List name="reimbursementForms">
        {(fields, { add, remove }) => (
          <>
            {fields.map(({ key, name, ...restField }) => (
              <div className="workflow-reimbursement-row" key={key}>
                <Form.Item {...restField} name={[name, "fundingBookNo"]} label="经费本编号">
                  <AutoComplete
                    allowClear
                    options={options}
                    notFoundContent={loading ? "正在读取最新版实验申请汇总表…" : undefined}
                    popupMatchSelectWidth={false}
                    placeholder="选择或输入经费本编号"
                  />
                </Form.Item>
                <Form.Item
                  {...restField}
                  name={[name, "formNo"]}
                  label={
                    <>
                      报销单号{" "}
                      <Tooltip title="已按本月自动生成 BXD1001YYYYMM000，请核对是否正确并完善报销单号">
                        <InfoCircleOutlined aria-label="报销单号生成说明" />
                      </Tooltip>
                    </>
                  }
                  rules={[{ required: true, message: "请填写报销单号" }]}
                >
                  <Input placeholder="报销单号" />
                </Form.Item>
                <Form.Item
                  {...restField}
                  name={[name, "amount"]}
                  label="金额（元）"
                  rules={[{ required: true, message: "请填写金额" }]}
                >
                  <InputNumber controls={false} min={0} precision={2} placeholder="金额（元）" />
                </Form.Item>
                <Button
                  className="workflow-reimbursement-remove"
                  aria-label={`删除第 ${name + 1} 行报销单`}
                  danger
                  icon={<MinusCircleOutlined aria-hidden />}
                  type="text"
                  onClick={() => remove(name)}
                />
              </div>
            ))}
            <Form.Item>
              <Button
                block
                icon={<PlusOutlined aria-hidden />}
                type="dashed"
                onClick={() => add({ formNo: "", amount: undefined, fundingBookNo: "" })}
              >
                添加报销单号
              </Button>
            </Form.Item>
          </>
        )}
      </Form.List>
    </div>
  );
}
