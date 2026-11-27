"use client";

import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FolderAddOutlined,
  HomeOutlined,
  ShareAltOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Breadcrumb, Button, Flex, Result, type MenuProps } from "antd";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import FileTable from "@/components/drive/FileTable";
import MoveModal from "@/components/drive/MoveModal";
import NameModal from "@/components/drive/NameModal";
import PreviewModal from "@/components/drive/PreviewModal";
import ServerFileModal from "@/components/drive/ServerFileModal";
import ServerViewToggle from "@/components/drive/ServerViewToggle";
import ShareModal from "@/components/drive/ShareModal";
import UploadZone from "@/components/drive/UploadZone";
import { apiErrorMessage } from "@/lib/api";
import { previewType } from "@/lib/preview";
import {
  createFolder,
  deleteFile,
  deleteFolder,
  downloadFile,
  listFolder,
  moveFile,
  moveFolder,
  renameFile,
  renameFolder,
  saveBlob,
  type DriveFile,
  type DriveItem,
} from "@/lib/storage";
import { useUiStore } from "@/stores/uiStore";

type Dialog =
  | { type: "create" }
  | { type: "rename"; item: DriveItem }
  | { type: "move"; item: DriveItem }
  | { type: "share"; item: DriveFile }
  | { type: "preview"; item: DriveFile }
  | { type: "server-file"; item: DriveFile }
  | null;

export default function DriveView({ folderId }: { folderId: string | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [dialog, setDialog] = useState<Dialog>(null);
  const serverView = useUiStore((s) => s.serverView);

  const { data, isPending, error } = useQuery({
    queryKey: ["folder", folderId ?? "root"],
    queryFn: () => listFolder(folderId),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["folder"] });
    void queryClient.invalidateQueries({ queryKey: ["tree"] });
    void queryClient.invalidateQueries({ queryKey: ["me"] }); // storage usage
  };

  /** Runs an action, refreshes the listing and reports errors. Re-throws so modals stay open on failure. */
  const run = async (action: () => Promise<void>, success?: string) => {
    try {
      await action();
      if (success) message.success(success);
      refresh();
    } catch (err) {
      message.error(apiErrorMessage(err));
      throw err;
    }
  };

  const openFolder = (id: string) => router.push(`/drive/${id}`);

  const download = async (item: DriveItem) => {
    if (item.kind !== "file") return;
    const key = `download-${item.id}`;
    message.loading({ content: `Скачиваем и расшифровываем «${item.name}»…`, key, duration: 0 });
    try {
      saveBlob(await downloadFile(item), item.name ?? "file");
      message.success({ content: "Готово", key });
    } catch (err) {
      message.error({ content: `Не удалось скачать: ${apiErrorMessage(err, "файл повреждён или ключ не подходит")}`, key });
    }
  };

  const confirmDelete = (item: DriveItem) =>
    modal.confirm({
      title: `Удалить «${item.name ?? "без имени"}»?`,
      content:
        item.kind === "folder"
          ? "Папка и всё её содержимое будут удалены безвозвратно."
          : "Файл будет удалён безвозвратно.",
      okText: "Удалить",
      okButtonProps: { danger: true },
      cancelText: "Отмена",
      onOk: () =>
        run(() => (item.kind === "folder" ? deleteFolder(item.id) : deleteFile(item.id)), "Удалено").catch(() => {}),
    });

  /** Click on a file: preview it, or show its ciphertext in "server's eyes" mode. */
  const openFile = (item: DriveItem) => {
    if (item.kind !== "file") return;
    if (serverView) setDialog({ type: "server-file", item });
    else if (previewType(item.name)) setDialog({ type: "preview", item });
    else void download(item);
  };

  const menuFor = (item: DriveItem): MenuProps => ({
    items: [
      ...(item.kind === "file"
        ? [
            ...(previewType(item.name) ? [{ key: "open", icon: <EyeOutlined />, label: "Открыть" }] : []),
            { key: "download", icon: <DownloadOutlined />, label: "Скачать", disabled: item.name === null },
            { key: "share", icon: <ShareAltOutlined />, label: "Поделиться", disabled: item.name === null },
          ]
        : []),
      { key: "rename", icon: <EditOutlined />, label: "Переименовать", disabled: item.name === null },
      { key: "move", icon: <SwapOutlined />, label: "Переместить" },
      { type: "divider" },
      { key: "delete", icon: <DeleteOutlined />, label: "Удалить", danger: true },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === "open" && item.kind === "file") setDialog({ type: "preview", item });
      if (key === "download") void download(item);
      if (key === "share" && item.kind === "file") setDialog({ type: "share", item });
      if (key === "rename") setDialog({ type: "rename", item });
      if (key === "move") setDialog({ type: "move", item });
      if (key === "delete") confirmDelete(item);
    },
  });

  if (error) {
    const notFound = axios.isAxiosError(error) && error.response?.status === 404;
    return (
      <Result
        status={notFound ? "404" : "error"}
        title={notFound ? "Папка не найдена" : "Не удалось загрузить папку"}
        subTitle={notFound ? undefined : apiErrorMessage(error)}
        extra={
          <Link href="/drive">
            <Button type="primary">На главную диска</Button>
          </Link>
        }
      />
    );
  }

  const breadcrumbItems = [
    { key: "root", title: <Link href="/drive"><HomeOutlined /> Мой диск</Link> },
    ...(data?.path ?? []).map((p, i, all) => {
      const label = serverView ? <code>{p.encryptedName.slice(0, 16)}…</code> : (p.name ?? "…");
      return { key: p.id, title: i === all.length - 1 ? label : <Link href={`/drive/${p.id}`}>{label}</Link> };
    }),
  ];

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Breadcrumb items={breadcrumbItems} />
        <Flex align="center" gap={16}>
          <ServerViewToggle />
          <Button icon={<FolderAddOutlined />} onClick={() => setDialog({ type: "create" })}>
            Новая папка
          </Button>
        </Flex>
      </Flex>

      {serverView && (
        <Alert
          type="warning"
          showIcon
          icon={<EyeOutlined />}
          title="Так ваш диск видит сервер"
          description="Имена папок и файлов, ключи и содержимое — зашифрованный base64 и случайные байты. Сервер знает только структуру папок, размеры и время загрузки. Нажмите на файл, чтобы увидеть его байты."
        />
      )}

      {/* key resets the upload list when navigating to another folder */}
      <UploadZone key={folderId ?? "root"} folderId={folderId} onUploaded={refresh} />

      <FileTable
        items={data?.items ?? []}
        loading={isPending}
        serverView={serverView}
        menuFor={menuFor}
        onOpenFolder={openFolder}
        onOpenFile={openFile}
      />

      {dialog?.type === "create" && (
        <NameModal
          title="Новая папка"
          okText="Создать"
          onSubmit={(name) => run(() => createFolder(name, folderId))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "rename" && (
        <NameModal
          title="Переименовать"
          okText="Сохранить"
          initialName={dialog.item.name ?? ""}
          onSubmit={(name) => {
            const { item } = dialog;
            return run(() => (item.kind === "folder" ? renameFolder(item.id, name) : renameFile(item, name)));
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "share" && <ShareModal file={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.type === "preview" && <PreviewModal file={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.type === "server-file" && <ServerFileModal file={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.type === "move" && (
        <MoveModal
          item={dialog.item}
          onSubmit={(target) => {
            const { item } = dialog;
            return run(
              () => (item.kind === "folder" ? moveFolder(item.id, target) : moveFile(item.id, target)),
              "Перемещено",
            );
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </Flex>
  );
}
