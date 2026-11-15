import { Alert, Button, Empty, Flex, Image, Select, Typography } from "antd";
import type { ReceptionCertificateAttachment, ReceptionRecognitionRun } from "../../../contracts/reception";

export function ReceptionCertificatePreview({
  attachments,
  attachment,
  latestRun,
  showFailure,
  recognizing,
  canLoadResult,
  disabled,
  pending,
  applyingResult,
  onSelect,
  onRefresh,
  onLoadResult,
}: {
  attachments: ReceptionCertificateAttachment[];
  attachment?: ReceptionCertificateAttachment;
  latestRun?: ReceptionRecognitionRun;
  showFailure: boolean;
  recognizing: boolean;
  canLoadResult: boolean;
  disabled: boolean;
  pending: boolean;
  applyingResult: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onLoadResult: () => void;
}) {
  const pageSelection = latestRun?.result?.pageSelection;
  return (
    <>
      {attachments.length ? (
        <Select
          aria-label="选择合格证原件"
          value={attachment?.id}
          options={attachments.map((item) => ({ value: item.id, label: `${item.name}（${item.pageCount} 页）` }))}
          onChange={onSelect}
          disabled={pending}
        />
      ) : null}
      {attachment ? (
        <>
          <Image
            width="100%"
            src={attachment.previewUrl}
            alt={`${attachment.name} 首页原图`}
            className="reception-certificate-preview"
            fallback=""
          />
          <Typography.Text type="secondary">
            此处仅预览首页，点击可放大；识别按所选范围处理候选页面，全部页面请下载原件核对。
          </Typography.Text>
          {pageSelection ? (
            <Alert
              showIcon
              type="info"
              title="本次识别页面范围"
              description={
                <Flex vertical gap={4}>
                  <span>
                    {pageSelection.mode === "all" ? "全部页面" : "自动筛选合格证页"}；原件共 {pageSelection.totalPages}{" "}
                    页。
                  </span>
                  <span>
                    送识别页码：
                    {pageSelection.selectedPages.length ? `第 ${pageSelection.selectedPages.join("、")} 页` : "无"}。
                  </span>
                  <span>
                    {pageSelection.skippedPhotoPages.length
                      ? `疑似照片跳过页码：第 ${pageSelection.skippedPhotoPages.join("、")} 页。`
                      : "未跳过疑似照片页。"}
                  </span>
                  <span>送识别的候选页不代表所有合格证均已成功识别，请下载原件核对完整性。</span>
                </Flex>
              }
            />
          ) : attachment.pageCount > 1 && latestRun?.status === "completed" && latestRun.result ? (
            <Alert
              showIcon
              type="warning"
              title="旧识别结果仅包含首页"
              description="此多页 PDF 的旧识别结果仅依据首页。建议重新识别，核对后再保存登记。"
            />
          ) : null}
          {latestRun?.status === "failed" && showFailure ? (
            <Alert
              showIcon
              type="warning"
              title="上次识别失败"
              description={latestRun.error || "可重新识别或手工填写明细。"}
            />
          ) : null}
          {latestRun?.status === "running" && !recognizing ? (
            <Alert
              showIcon
              type="info"
              title="此原件有进行中的识别记录"
              action={<Button onClick={onRefresh}>刷新状态</Button>}
            />
          ) : null}
          {canLoadResult ? (
            <Alert
              showIcon
              type="info"
              title="识别已完成，明细尚未载入"
              description="载入已有结果后可继续核对，无需再次识别。"
              action={
                <Button disabled={disabled} loading={applyingResult} onClick={onLoadResult}>
                  载入识别结果
                </Button>
              }
            />
          ) : null}
        </>
      ) : (
        <Empty description="尚未上传合格证原件" />
      )}
    </>
  );
}
