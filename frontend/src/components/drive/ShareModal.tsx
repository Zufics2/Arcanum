"use client";

import { CopyOutlined, DeleteOutlined, LinkOutlined, LockOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Divider, Empty, Flex, Form, Input, Modal, Select, Space, Spin, Tag, Typography, theme } from "antd";
import dayjs from "dayjs";
import { useState } from "react";

import { apiErrorMessage } from "@/lib/api";
import { createShareLink, deleteShareLink, listShareLinks, type ShareLink } from "@/lib/sharing";
import type { DriveFile } from "@/lib/storage";

const EXPIRY_OPTIONS = [
  { value: 1, label: "1 час" },
  { value: 24, label: "1 день" },
  { value: 24 * 7, label: "7 дней" },
  { value: 24 * 30, label: "30 дней" },
  { value: 0, label: "Без срока" },
];

const DOWNLOAD_OPTIONS = [
  { value: 1, label: "1 скачивание" },
  { value: 5, label: "5 скачиваний" },
  { value: 10, label: "10 скачиваний" },
  { value: 100, label: "100 скачиваний" },
  { value: 0, label: "Без ограничений" },
];

function describe(link: ShareLink): string {
  const parts = [
    link.expiresAt ? `до ${dayjs(link.expiresAt).format("D MMM, HH:mm")}` : "без срока",
    link.maxDownloads ? `скачано ${link.downloadCount} из ${link.maxDownloads}` : `скачано ${link.downloadCount}`,
  ];
  return parts.join(" · ");
}

interface ShareModalProps {
  file: DriveFile;
  onClose: () => void;
}

export default function ShareModal({ file, onClose }: ShareModalProps) {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ expiry: number; downloads: number }>();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ShareLink | null>(null);

  const queryKey = ["share-links", file.id];
  const { data: links = [], isPending } = useQuery({ queryKey, queryFn: () => listShareLinks(file) });

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    message.success("Ссылка скопирована");
  };

  const create = async () => {
    const { expiry, downloads } = form.getFieldsValue();
    setCreating(true);
    try {
      const link = await createShareLink(file, {
        expiresInHours: expiry || null,
        maxDownloads: downloads || null,
      });
      setCreated(link);
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      message.error(apiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const revoke = (link: ShareLink) =>
    modal.confirm({
      title: "Отозвать ссылку?",
      content: "По ней больше нельзя будет скачать файл",
      okText: "Отозвать",
      okButtonProps: { danger: true },
      cancelText: "Отмена",
      onOk: async () => {
        try {
          await deleteShareLink(link.id);
          if (created?.id === link.id) setCreated(null);
          await queryClient.invalidateQueries({ queryKey });
        } catch (err) {
          message.error(apiErrorMessage(err));
        }
      },
    });

  return (
    <Modal open title={`Поделиться «${file.name}»`} footer={null} onCancel={onClose} width={560}>
      <Form form={form} layout="inline" initialValues={{ expiry: 24 * 7, downloads: 0 }} style={{ rowGap: 8 }}>
        <Form.Item name="expiry" label="Срок">
          <Select options={EXPIRY_OPTIONS} style={{ width: 130 }} />
        </Form.Item>
        <Form.Item name="downloads" label="Лимит">
          <Select options={DOWNLOAD_OPTIONS} style={{ width: 170 }} />
        </Form.Item>
        <Button type="primary" icon={<LinkOutlined />} loading={creating} onClick={create}>
          Создать ссылку
        </Button>
      </Form>

      {created && (
        <Space.Compact style={{ width: "100%", marginTop: 16 }}>
          <Input value={created.url} readOnly onFocus={(e) => e.target.select()} />
          <Button type="primary" icon={<CopyOutlined />} onClick={() => copy(created.url)}>
            Копировать
          </Button>
        </Space.Compact>
      )}

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
        <LockOutlined /> Ключ расшифровки это, часть ссылки после «#». Отправляйте ссылку только тому, кому доверяете.
      </Typography.Paragraph>

      <Divider titlePlacement="start" plain>
        Активные ссылки
      </Divider>

      {isPending ? (
        <Flex justify="center" style={{ padding: 16 }}>
          <Spin />
        </Flex>
      ) : links.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ссылок пока нет" />
      ) : (
        <Flex vertical>
          {links.map((link, i) => (
            <Flex
              key={link.id}
              align="center"
              justify="space-between"
              gap={8}
              style={{ padding: "8px 0", borderTop: i ? `1px solid ${token.colorBorderSecondary}` : undefined }}
            >
              <Flex vertical gap={2} style={{ minWidth: 0 }}>
                <Space size={6}>
                  <Typography.Text>Создана {dayjs(link.createdAt).format("D MMM, HH:mm")}</Typography.Text>
                  {link.downloadsLeft === 1 && <Tag color="orange">последнее скачивание</Tag>}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {describe(link)}
                </Typography.Text>
              </Flex>
              <Space size={0}>
                <Button type="text" icon={<CopyOutlined />} onClick={() => copy(link.url)} aria-label="Копировать" />
                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => revoke(link)} aria-label="Отозвать" />
              </Space>
            </Flex>
          ))}
        </Flex>
      )}
    </Modal>
  );
}
