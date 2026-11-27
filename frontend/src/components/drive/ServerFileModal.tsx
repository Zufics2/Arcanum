"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Descriptions, Flex, Modal, Spin, Typography, theme } from "antd";
import dayjs from "dayjs";
import type { CSSProperties } from "react";

import { formatBytes } from "@/lib/format";
import { fetchCiphertextHead, type DriveFile } from "@/lib/storage";

const HEAD_BYTES = 512;
const IV_BYTES = 12;
const mono: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 };

function HexDump({ bytes, totalSize }: { bytes: Uint8Array; totalSize: number }) {
  const { token } = theme.useToken();
  const rows = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = Array.from(bytes.slice(offset, offset + 16));
    rows.push(
      <div key={offset} style={{ whiteSpace: "pre" }}>
        <span style={{ color: token.colorTextTertiary }}>{offset.toString(16).padStart(8, "0")}  </span>
        {row.map((b, i) => (
          <span key={i} style={{ color: offset + i < IV_BYTES ? token.colorWarning : undefined }}>
            {b.toString(16).padStart(2, "0")}
            {i === 7 ? "  " : " "}
          </span>
        ))}
        {"   ".repeat(16 - row.length)}
        <span style={{ color: token.colorTextSecondary }}>
          {" "}
          {row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("")}
        </span>
      </div>,
    );
  }
  return (
    <div style={{ ...mono, padding: 12, borderRadius: token.borderRadius, background: token.colorFillTertiary, overflowX: "auto" }}>
      {rows}
      {totalSize > bytes.length && (
        <div style={{ color: token.colorTextTertiary, marginTop: 4 }}>… ещё {formatBytes(totalSize - bytes.length)}</div>
      )}
    </div>
  );
}

interface ServerFileModalProps {
  file: DriveFile;
  onClose: () => void;
}

/** A file exactly as stored on the server: opaque base64 strings and random-looking bytes. */
export default function ServerFileModal({ file, onClose }: ServerFileModalProps) {
  const { token } = theme.useToken();
  const { data, isPending } = useQuery({
    queryKey: ["cipher-head", file.id],
    queryFn: () => fetchCiphertextHead(file.id, HEAD_BYTES),
    gcTime: 0,
  });

  return (
    <Modal open title="Файл глазами сервера" width={760} footer={null} onCancel={onClose}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="Это всё, что знает сервер"
        description="Имя, ключ и содержимое зашифрованы в вашем браузере. Без пароля это просто случайные байты."
      />
      <Descriptions size="small" column={1} bordered styles={{ label: { width: 190 } }}>
        <Descriptions.Item label="id">
          <Typography.Text style={mono}>{file.id}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="encrypted_name">
          <Typography.Text style={{ ...mono, wordBreak: "break-all" }}>{file.encryptedName}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="encrypted_file_key">
          <Typography.Text style={{ ...mono, wordBreak: "break-all" }}>{file.encryptedFileKey}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="size">{file.encryptedSize.toLocaleString("ru")} байт</Descriptions.Item>
        <Descriptions.Item label="created_at">{dayjs(file.createdAt).format("YYYY-MM-DD HH:mm:ss")}</Descriptions.Item>
      </Descriptions>

      <Typography.Title level={5} style={{ marginTop: 20 }}>
        Содержимое на диске (первые {HEAD_BYTES} байт)
      </Typography.Title>
      {isPending || !data ? (
        <Flex justify="center" style={{ padding: 24 }}>
          <Spin />
        </Flex>
      ) : (
        <HexDump bytes={data} totalSize={file.encryptedSize} />
      )}
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
        <span style={{ color: token.colorWarning }}>■</span> первые 12 байт — IV (вектор инициализации, случайный для
        каждого шифрования), дальше — шифротекст AES-256-GCM, последние 16 байт файла — тег целостности.
      </Typography.Paragraph>
    </Modal>
  );
}
