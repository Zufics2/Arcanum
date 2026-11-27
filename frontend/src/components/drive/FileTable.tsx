"use client";

import { FileOutlined, FolderFilled, MoreOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space, Table, Typography, type MenuProps, type TableColumnsType } from "antd";
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

function ItemName({ item, onOpenFolder }: { item: DriveItem; onOpenFolder: (id: string) => void }) {
  const icon =
    item.kind === "folder" ? <FolderFilled style={{ color: "#f5b301" }} /> : <FileOutlined />;
  const label =
    item.name ?? (
      <Typography.Text type="danger">
        <WarningOutlined /> не удалось расшифровать
      </Typography.Text>
    );

  return (
    <Space>
      {icon}
      {item.kind === "folder" ? (
        <Typography.Link onClick={() => onOpenFolder(item.id)}>{label}</Typography.Link>
      ) : (
        label
      )}
    </Space>
  );
}

interface FileTableProps {
  items: DriveItem[];
  loading: boolean;
  menuFor: MenuFor;
  onOpenFolder: (id: string) => void;
}

export default function FileTable({ items, loading, menuFor, onOpenFolder }: FileTableProps) {
  const columns: TableColumnsType<DriveItem> = [
    {
      title: "Имя",
      key: "name",
      sorter: byKindThenName,
      defaultSortOrder: "ascend",
      render: (_, item) => <ItemName item={item} onOpenFolder={onOpenFolder} />,
    },
    {
      title: "Размер",
      key: "size",
      width: 120,
      sorter: (a, b) => (a.kind === "file" ? a.size : -1) - (b.kind === "file" ? b.size : -1),
      render: (_, item) => (item.kind === "file" ? formatBytes(item.size) : "—"),
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
        onRow={(item) => ({ item, onDoubleClick: () => item.kind === "folder" && onOpenFolder(item.id) }) as HTMLAttributes<HTMLTableRowElement>}
        locale={{ emptyText: "Папка пуста. Перетащите файлы сюда, чтобы загрузить." }}
      />
    </RowMenuContext.Provider>
  );
}
