"use client";

import { FileOutlined, FolderFilled, MoreOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space, Table, Tooltip, Typography, type MenuProps, type TableColumnsType } from "antd";
import dayjs from "dayjs";
import { createContext, useContext, type HTMLAttributes } from "react";

import { formatBytes } from "@/lib/format";
import type { DriveItem } from "@/lib/storage";

type MenuFor = (item: DriveItem) => MenuProps;

// Lets the custom table row open the same menu on right click without re-creating the row component.
const RowMenuContext = createContext<MenuFor | null>(null);

function ContextMenuRow({ item, ...rest }: HTMLAttributes<HTMLTableRowElement> & { item?: DriveItem }) {
  const menuFor = useContext(RowMenuContext);
  if (!item || !menuFor) return <tr {...rest} />;
  return (
    <Dropdown menu={menuFor(item)} trigger={["contextMenu"]}>
      <tr {...rest} />
    </Dropdown>
  );
}

const byKindThenName = (a: DriveItem, b: DriveItem) =>
  a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : (a.name ?? "").localeCompare(b.name ?? "", "ru");

function truncateMiddle(value: string, max = 40): string {
  return value.length <= max ? value : `${value.slice(0, max - 12)}…${value.slice(-8)}`;
}

interface ItemNameProps {
  item: DriveItem;
  serverView: boolean;
  onOpenFolder: (id: string) => void;
  onOpenFile: (item: DriveItem) => void;
}

function ItemName({ item, serverView, onOpenFolder, onOpenFile }: ItemNameProps) {
  const icon =
    item.kind === "folder" ? <FolderFilled style={{ color: "#f5b301" }} /> : <FileOutlined />;
  const open = () => (item.kind === "folder" ? onOpenFolder(item.id) : onOpenFile(item));

  if (serverView) {
    return (
      <Space>
        {icon}
        <Tooltip title={<span style={{ wordBreak: "break-all" }}>{item.encryptedName}</span>}>
          <Typography.Link code onClick={open}>
            {truncateMiddle(item.encryptedName)}
          </Typography.Link>
        </Tooltip>
      </Space>
    );
  }

  const label =
    item.name ?? (
      <Typography.Text type="danger">
        <WarningOutlined /> не удалось расшифровать
      </Typography.Text>
    );

  return (
    <Space>
      {icon}
      {item.name === null ? label : <Typography.Link onClick={open}>{label}</Typography.Link>}
    </Space>
  );
}

interface FileTableProps {
  items: DriveItem[];
  loading: boolean;
  serverView: boolean;
  menuFor: MenuFor;
  onOpenFolder: (id: string) => void;
  onOpenFile: (item: DriveItem) => void;
}

export default function FileTable({ items, loading, serverView, menuFor, onOpenFolder, onOpenFile }: FileTableProps) {
  const columns: TableColumnsType<DriveItem> = [
    {
      title: serverView ? "encrypted_name" : "Имя",
      key: "name",
      sorter: byKindThenName,
      defaultSortOrder: "ascend",
      render: (_, item) => (
        <ItemName item={item} serverView={serverView} onOpenFolder={onOpenFolder} onOpenFile={onOpenFile} />
      ),
    },
    {
      title: serverView ? "size" : "Размер",
      key: "size",
      width: 140,
      sorter: (a, b) => (a.kind === "file" ? a.size : -1) - (b.kind === "file" ? b.size : -1),
      render: (_, item) =>
        item.kind !== "file" ? "—" : serverView ? `${item.encryptedSize.toLocaleString("ru")} Б` : formatBytes(item.size),
    },
    {
      title: "Создан",
      key: "createdAt",
      width: 200,
      sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
      render: (_, item) => dayjs(item.createdAt).format("D MMM YYYY, HH:mm"),
    },
    {
      key: "actions",
      width: 56,
      align: "right",
      render: (_, item) => (
        <Dropdown menu={menuFor(item)} trigger={["click"]}>
          <Button type="text" icon={<MoreOutlined />} aria-label="Действия" />
        </Dropdown>
      ),
    },
  ];

  return (
    <RowMenuContext.Provider value={menuFor}>
      <Table<DriveItem>
        rowKey={(item) => `${item.kind}:${item.id}`}
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={false}
        components={{ body: { row: ContextMenuRow } }}
        onRow={(item) =>
          ({
            item,
            onDoubleClick: () => (item.kind === "folder" ? onOpenFolder(item.id) : onOpenFile(item)),
          }) as HTMLAttributes<HTMLTableRowElement>
        }
        locale={{ emptyText: "Папка пуста. Перетащите файлы сюда, чтобы загрузить." }}
      />
    </RowMenuContext.Provider>
  );
}
