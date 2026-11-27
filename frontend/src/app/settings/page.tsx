"use client";

import { DeleteOutlined, KeyOutlined, LockOutlined, UploadOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Flex, Form, Input, Progress, Space, Tag, Typography, Upload, theme } from "antd";
import { useState } from "react";

import PasswordPrompt from "@/components/PasswordPrompt";
import RecoveryKeyModal from "@/components/RecoveryKeyModal";
import UserAvatar from "@/components/UserAvatar";
import { useCustomAvatarUrl, useMe } from "@/hooks/useProfile";
import { apiErrorMessage, hasFieldError } from "@/lib/api";
import { changePassword, disableRecoveryKey } from "@/lib/auth";
import { DEFAULT_AVATARS, defaultAvatarUrl } from "@/lib/avatars";
import { formatBytes } from "@/lib/format";
import { deleteAvatar, setDefaultAvatar, uploadAvatar } from "@/lib/profile";
import { useAuthStore } from "@/stores/authStore";

const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;

function ProfileCard() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const username = useAuthStore((s) => s.session?.username ?? "");
  const { data: me } = useMe();
  const customUrl = useCustomAvatarUrl();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.removeQueries({ queryKey: ["avatar"] });
      message.success(success);
    } catch (err) {
      message.error(apiErrorMessage(err, "Не удалось обработать изображение"));
    } finally {
      setBusy(false);
    }
  };

  const selected = me?.has_custom_avatar ? null : me?.default_avatar;

  return (
    <Card title="Профиль">
      <Flex gap={24} wrap align="flex-start">
        <Flex vertical align="center" gap={8}>
          <UserAvatar username={username} defaultAvatar={me?.default_avatar} customUrl={customUrl} size={96} />
          <Typography.Text strong>{username}</Typography.Text>
        </Flex>

        <Flex vertical gap={16} style={{ flex: 1, minWidth: 260 }}>
          <div>
            <Typography.Text type="secondary">Встроенные иконки</Typography.Text>
            <Flex wrap gap={8} style={{ marginTop: 8 }}>
              {DEFAULT_AVATARS.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={busy}
                  aria-label={name}
                  aria-pressed={selected === name}
                  onClick={() => selected !== name && run(() => setDefaultAvatar(name), "Иконка изменена")}
                  style={{
                    padding: 2,
                    borderRadius: "50%",
                    cursor: "pointer",
                    background: "transparent",
                    border: `2px solid ${selected === name ? token.colorPrimary : "transparent"}`,
                  }}
                >
                  <UserAvatar username={username} customUrl={defaultAvatarUrl(name)} size={44} />
                </button>
              ))}
            </Flex>
          </div>

          <Space wrap>
            <Upload
              accept="image/png,image/jpeg,image/webp,image/gif"
              showUploadList={false}
              disabled={busy}
              beforeUpload={(file) => {
                if (file.size > MAX_SOURCE_IMAGE_BYTES) {
                  message.error("Изображение больше 10 МБ");
                } else {
                  void run(() => uploadAvatar(file), "Фото профиля обновлено");
                }
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={busy}>
                Загрузить своё фото
              </Button>
            </Upload>
            {me?.has_custom_avatar && (
              <Button icon={<DeleteOutlined />} disabled={busy} onClick={() => run(deleteAvatar, "Фото удалено")}>
                Удалить фото
              </Button>
            )}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <LockOutlined /> Фото уменьшается до 256×256 и шифруется в браузере — сервер его не видит.
          </Typography.Text>
        </Flex>
      </Flex>
    </Card>
  );
}

interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  confirm: string;
}

function PasswordCard() {
  const { message } = App.useApp();
  const [form] = Form.useForm<PasswordForm>();
  const [loading, setLoading] = useState(false);

  const onFinish = async ({ oldPassword, newPassword }: PasswordForm) => {
    setLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      form.resetFields();
      message.success("Пароль изменён");
    } catch (err) {
      if (hasFieldError(err, "old_auth_hash")) {
        form.setFields([{ name: "oldPassword", errors: ["Неверный текущий пароль"] }]);
      } else {
        message.error(apiErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Смена пароля">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="Файлы не перешифровываются"
        description="Меняется только ключ, которым защищён ваш мастер-ключ. Старый пароль после смены перестанет работать, восстановить его будет нельзя."
      />
      <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false} disabled={loading} style={{ maxWidth: 400 }}>
        <Form.Item name="oldPassword" label="Текущий пароль" rules={[{ required: true, message: "Введите текущий пароль" }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="Новый пароль"
          hasFeedback
          dependencies={["oldPassword"]}
          rules={[
            { required: true, message: "Введите новый пароль" },
            { min: 8, message: "Минимум 8 символов" },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || value !== getFieldValue("oldPassword")
                  ? Promise.resolve()
                  : Promise.reject(new Error("Новый пароль совпадает с текущим")),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="Повторите новый пароль"
          hasFeedback
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: "Повторите пароль" },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || value === getFieldValue("newPassword")
                  ? Promise.resolve()
                  : Promise.reject(new Error("Пароли не совпадают")),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading}>
          {loading ? "Перешифровываем ключ…" : "Сменить пароль"}
        </Button>
      </Form>
    </Card>
  );
}

function RecoveryCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const username = useAuthStore((s) => s.session?.username ?? "");
  const { data: me } = useMe();
  const [dialog, setDialog] = useState<"create" | "disable" | null>(null);
  const enabled = !!me?.has_recovery_key;
  const refreshMe = () => queryClient.invalidateQueries({ queryKey: ["me"] });

  return (
    <Card
      id="recovery"
      title={
        <Space>
          <KeyOutlined /> Ключ восстановления
          {me && (enabled ? <Tag color="success">создан</Tag> : <Tag color="warning">не создан</Tag>)}
        </Space>
      }
    >
      <Typography.Paragraph>
        Если вы забудете пароль, ключ восстановления — единственный способ вернуть доступ к файлам. Без него данные будут
        потеряны навсегда: сервер их расшифровать не может.
      </Typography.Paragraph>
      {!enabled && me && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="Рекомендуем создать ключ и хранить его офлайн"
        />
      )}
      <Space wrap>
        <Button type={enabled ? "default" : "primary"} icon={<KeyOutlined />} onClick={() => setDialog("create")}>
          {enabled ? "Создать новый ключ" : "Создать ключ"}
        </Button>
        {enabled && (
          <Button danger onClick={() => setDialog("disable")}>
            Отключить
          </Button>
        )}
      </Space>

      {dialog === "create" && (
        <RecoveryKeyModal
          username={username}
          replacing={enabled}
          onDone={refreshMe}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "disable" && (
        <PasswordPrompt
          title="Отключить ключ восстановления?"
          okText="Отключить"
          danger
          description="Сохранённый ключ перестанет работать. Если вы забудете пароль, доступ к файлам будет потерян."
          onSubmit={async (password) => {
            try {
              await disableRecoveryKey(password);
            } catch (err) {
              if (!hasFieldError(err, "auth_hash")) message.error(apiErrorMessage(err));
              throw err;
            }
            await refreshMe();
            message.success("Ключ восстановления отключён");
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </Card>
  );
}

function StorageCard() {
  const { data: me } = useMe();
  const used = me?.storage_used ?? 0;
  const quota = me?.storage_quota ?? 0;
  const percent = quota ? Math.min(100, Math.round((used / quota) * 1000) / 10) : 0;

  return (
    <Card title="Хранилище">
      <Typography.Paragraph>
        Занято <b>{formatBytes(used)}</b> из {formatBytes(quota)}
      </Typography.Paragraph>
      <Progress percent={percent} status={percent >= 90 ? "exception" : "normal"} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Учитывается размер зашифрованных данных.
      </Typography.Text>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <Flex vertical gap={16} style={{ maxWidth: 800, margin: "0 auto" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Настройки
      </Typography.Title>
      <ProfileCard />
      <PasswordCard />
      <RecoveryCard />
      <StorageCard />
    </Flex>
  );
}
