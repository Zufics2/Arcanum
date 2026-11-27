"use client";

import { CheckCircleOutlined, DownloadOutlined, FileOutlined, LockOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Flex, Progress, Result, Spin, Typography, theme } from "antd";
import axios from "axios";
import dayjs from "dayjs";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import { InvalidShareKeyError } from "@/lib/crypto";
import { formatBytes } from "@/lib/format";
import { WrongShareKeyError, downloadSharedFile, getSharedFile, importSharedFileKey } from "@/lib/sharing";
import { saveBlob } from "@/lib/storage";

// The key lives in the URL fragment, which exists only in the browser (never sent to the server).
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const useHash = () =>
  useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => null, // during server rendering there is no fragment
  );

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh", padding: 16 }}>
      <ThemeToggle style={{ position: "fixed", top: 16, right: 16 }} />
      <Card style={{ width: "100%", maxWidth: 440 }}>{children}</Card>
    </Flex>
  );
}

function Failure({ title, subTitle }: { title: string; subTitle: string }) {
  return (
    <Shell>
      <Result status="warning" title={title} subTitle={subTitle} extra={<Link href="/">На главную Arcanum</Link>} />
    </Shell>
  );
}

export default function SharedFilePage() {
  const { id } = useParams<{ id: string }>();
  const fragment = useHash();
  const { token } = theme.useToken();
  const [progress, setProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ["shared", id, fragment],
    enabled: !!fragment,
    retry: false,
    queryFn: async () => {
      const key = await importSharedFileKey(fragment!);
      return { key, file: await getSharedFile(id, key) };
    },
  });

  if (fragment === null) return <Spin fullscreen />;
  if (!fragment) {
    return <Failure title="Ссылка неполная" subTitle="В ней нет ключа расшифровки (части после «#»). Попросите отправителя прислать ссылку целиком." />;
  }
  if (isPending) return <Spin fullscreen description="Расшифровываем…" />;
  if (error) {
    if (error instanceof InvalidShareKeyError || error instanceof WrongShareKeyError) {
      return <Failure title="Ключ не подходит" subTitle="Ссылка повреждена: файл нельзя расшифровать. Проверьте, что она скопирована полностью." />;
    }
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return <Failure title="Ссылка недействительна" subTitle="Срок её действия истёк, лимит скачиваний исчерпан или владелец её отозвал." />;
    }
    return <Failure title="Не удалось открыть ссылку" subTitle="Сервер недоступен. Попробуйте позже." />;
  }

  const { key, file } = data;
  const lastDownload = file.downloadsLeft === 1;

  const download = async () => {
    setDownloadError(null);
    setProgress(0);
    try {
      saveBlob(await downloadSharedFile(id, key, setProgress), file.name);
      setDownloaded(true);
    } catch (err) {
      setDownloadError(
        err instanceof WrongShareKeyError
          ? "Файл не удалось расшифровать."
          : axios.isAxiosError(err) && err.response?.status === 404
            ? "Ссылка больше недействительна."
            : "Не удалось скачать файл.",
      );
    } finally {
      setProgress(null);
    }
  };

  return (
    <Shell>
      <Flex vertical align="center" gap={12} style={{ textAlign: "center" }}>
        <FileOutlined style={{ fontSize: 48, color: token.colorPrimary }} />
        <Typography.Title level={4} style={{ margin: 0, wordBreak: "break-word" }}>
          {file.name}
        </Typography.Title>
        <Typography.Text type="secondary">
          {formatBytes(file.size)}
          {file.expiresAt && ` · доступна до ${dayjs(file.expiresAt).format("D MMM YYYY, HH:mm")}`}
        </Typography.Text>
        {file.downloadsLeft !== null && !downloaded && (
          <Typography.Text type={lastDownload ? "warning" : "secondary"}>
            {lastDownload
              ? "Это последнее скачивание: после него ссылка самоуничтожится"
              : `Осталось скачиваний: ${file.downloadsLeft}`}
          </Typography.Text>
        )}

        {progress !== null ? (
          <Progress percent={progress} style={{ width: "100%" }} />
        ) : downloaded ? (
          <Typography.Text type="success">
            <CheckCircleOutlined /> Файл расшифрован и сохранён
          </Typography.Text>
        ) : (
          <Button type="primary" size="large" icon={<DownloadOutlined />} onClick={download} block>
            Скачать
          </Button>
        )}
        {downloadError && <Typography.Text type="danger">{downloadError}</Typography.Text>}

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <LockOutlined /> Файл расшифровывается в вашем браузере. Сервер Arcanum не знает ни его содержимого, ни имени.
        </Typography.Text>
      </Flex>
    </Shell>
  );
}
