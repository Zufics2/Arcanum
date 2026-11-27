"use client";

import { DownloadOutlined, LockOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Button, Flex, Modal, Result, Spin, Typography, theme } from "antd";
import { useEffect } from "react";

import { apiErrorMessage } from "@/lib/api";
import { MAX_TEXT_PREVIEW_BYTES, previewType } from "@/lib/preview";
import { downloadFile, saveBlob, type DriveFile } from "@/lib/storage";

interface PreviewModalProps {
  file: DriveFile;
  onClose: () => void;
}

/** Decrypts a file in memory and shows it without saving it to disk. */
export default function PreviewModal({ file, onClose }: PreviewModalProps) {
  const { token } = theme.useToken();
  const type = previewType(file.name);
  const tooBigForText = type?.kind === "text" && file.size > MAX_TEXT_PREVIEW_BYTES;

  const { data, error, isPending } = useQuery({
    queryKey: ["preview", file.id],
    enabled: !!type && !tooBigForText,
    gcTime: 0, // don't keep decrypted content around after closing
    queryFn: async () => {
      const blob = await downloadFile(file, type!.mime);
      return {
        blob,
        url: URL.createObjectURL(blob),
        text: type!.kind === "text" ? await blob.text() : null,
      };
    },
  });

  useEffect(() => () => {
    if (data) URL.revokeObjectURL(data.url);
  }, [data]);

  const save = () => data && saveBlob(data.blob, file.name ?? "file");

  let body: React.ReactNode;
  if (!type || tooBigForText) {
    body = (
      <Result
        status="info"
        title={tooBigForText ? "Файл слишком большой для просмотра" : "Предпросмотр недоступен"}
        subTitle="Этот тип файла можно только скачать."
      />
    );
  } else if (isPending) {
    body = (
      <Flex vertical align="center" gap={12} style={{ padding: 48 }}>
        <Spin size="large" />
        <Typography.Text type="secondary">Скачиваем и расшифровываем…</Typography.Text>
      </Flex>
    );
  } else if (error || !data) {
    body = <Result status="error" title="Не удалось открыть файл" subTitle={apiErrorMessage(error, "Файл повреждён или ключ не подходит")} />;
  } else {
    const frame = { width: "100%", maxHeight: "70vh", borderRadius: token.borderRadius } as const;
    body = {
      image: (
        <Flex justify="center">
          {/* eslint-disable-next-line @next/next/no-img-element -- decrypted blob: URL, not an optimizable asset */}
          <img src={data.url} alt={file.name ?? ""} style={{ ...frame, width: "auto", maxWidth: "100%", objectFit: "contain" }} />
        </Flex>
      ),
      pdf: <iframe src={data.url} title={file.name ?? "PDF"} style={{ ...frame, height: "70vh", border: 0 }} />,
      video: <video src={data.url} controls style={frame} />,
      audio: <audio src={data.url} controls style={{ width: "100%" }} />,
      text: (
        <pre
          style={{
            ...frame,
            overflow: "auto",
            margin: 0,
            padding: 16,
            background: token.colorFillTertiary,
            fontSize: 13,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {data.text}
        </pre>
      ),
    }[type.kind];
  }

  return (
    <Modal
      open
      title={file.name}
      width={type?.kind === "audio" ? 520 : 960}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Flex justify="space-between" align="center">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <LockOutlined /> Расшифровано в браузере, на диск не сохраняется
          </Typography.Text>
          <Flex gap={8}>
            {data && (
              <Button icon={<DownloadOutlined />} onClick={save}>
                Скачать
              </Button>
            )}
            <Button onClick={onClose}>Закрыть</Button>
          </Flex>
        </Flex>
      }
    >
      {body}
    </Modal>
  );
}
