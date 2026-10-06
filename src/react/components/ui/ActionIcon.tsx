import {
  ArrowLeftOutlined,
  BookOutlined,
  CheckCircleOutlined,
  ClearOutlined,
  CodeOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HistoryOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  LoginOutlined,
  LikeOutlined,
  PlusOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SaveOutlined,
  ScanOutlined,
  SearchOutlined,
  SelectOutlined,
  SendOutlined,
  SyncOutlined,
  UndoOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { ComponentProps } from "react";

const actionIcons = {
  back: ArrowLeftOutlined,
  clear: ClearOutlined,
  create: PlusOutlined,
  document: BookOutlined,
  download: DownloadOutlined,
  edit: EditOutlined,
  enter: LoginOutlined,
  history: HistoryOutlined,
  import: ImportOutlined,
  info: InfoCircleOutlined,
  print: PrinterOutlined,
  refresh: ReloadOutlined,
  remove: DeleteOutlined,
  reserve: CheckCircleOutlined,
  save: SaveOutlined,
  scan: ScanOutlined,
  search: SearchOutlined,
  select: SelectOutlined,
  send: SendOutlined,
  sync: SyncOutlined,
  support: LikeOutlined,
  undo: UndoOutlined,
  repository: CodeOutlined,
  upload: UploadOutlined,
};

export type ActionIconName = keyof typeof actionIcons;

/** Explicit action semantics, shared by buttons and menus; labels remain the accessible names. */
export function ActionIcon({
  name,
  className,
  style,
}: { name: ActionIconName } & Pick<ComponentProps<typeof ArrowLeftOutlined>, "className" | "style">) {
  const Icon = actionIcons[name];
  return <Icon aria-hidden="true" className={className} style={style} />;
}
