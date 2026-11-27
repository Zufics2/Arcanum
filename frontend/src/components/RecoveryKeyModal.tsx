"use client";

import { CopyOutlined, DownloadOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, App, Button, Checkbox, Flex, Modal, Typography, theme } from "antd";
import { useState } from "react";

import PasswordPrompt from "@/components/PasswordPrompt";
import { apiErrorMessage, hasFieldError } from "@/lib/api";
import { setupRecoveryKey } from "@/lib/auth";
import { saveBlob } from "@/lib/storage";

function recoveryFileText(username: string, key: string): string {
  return [
    "Arcanum — ключ восстановления",
    "",
    `Логин: ${username}`,
    `Ключ:  ${key}`,
    "",
    "Этот ключ позволяет задать новый пароль, если вы забудете старый.",
    "Любой, у кого есть логин и этот ключ, получит доступ к вашим файлам.",
    "Храните его офлайн: распечатайте или запишите. Не храните рядом с паролем.",
    "",
  ].join("\n");
}

interface RecoveryKeyModalProps {
  username: string;
  replacing: boolean;
  onDone: () => void;
  onClose: () => void;
}

/** Step 1: confirm password and generate. Step 2: show the key once, make the user save it. */
export default function RecoveryKeyModal({ username, replacing, onDone, onClose }: RecoveryKeyModalProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [key, setKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!key) {
    return (
      <PasswordPrompt
        title={replacing ? "Создать новый ключ восстановления" : "Создать ключ восстановления"}
        okText="Создать"
        description={
          replacing ? (
            <Alert type="warning" showIcon title="Старый ключ перестанет работать" />
          ) : (
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              Ключ восстановления позволит задать новый пароль, если вы забудете текущий. Он будет показан один раз.
            </Typography.Paragraph>
          )
        }
        onSubmit={async (password) => {
          try {
            setKey(await setupRecoveryKey(password));
            onDone();
          } catch (err) {
            if (!hasFieldError(err, "auth_hash")) message.error(apiErrorMessage(err));
            throw err;
          }
        }}
        onClose={onClose}
      />
    );
  }

  const download = () =>
    saveBlob(new Blob([recoveryFileText(username, key)], { type: "text/plain;charset=utf-8" }), `arcanum-recovery-${username}.txt`);

  const copy = async () => {
    await navigator.clipboard.writeText(key);
    message.success("Ключ скопирован");
  };

  return (
    <Modal
      open
      title="Ваш ключ восстановления"
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      footer={
        <Button type="primary" disabled={!saved} onClick={onClose}>
          Готово
        </Button>
      }
    >
      <Alert
        type="warning"
        showIcon
        icon={<WarningOutlined />}
        title="Сохраните ключ сейчас — больше он показан не будет"
        description="Сервер хранит только производный от ключа хеш и не сможет его напомнить."
        style={{ marginBottom: 16 }}
      />
      <div
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 16,
          lineHeight: 1.7,
          letterSpacing: 1,
          padding: 16,
          borderRadius: token.borderRadiusLG,
          background: token.colorFillTertiary,
          textAlign: "center",
          wordBreak: "break-word",
          userSelect: "all",
        }}
      >
        {key}
      </div>
      <Flex gap={8} style={{ margin: "16px 0" }}>
        <Button icon={<DownloadOutlined />} onClick={download}>
          Скачать .txt
        </Button>
        <Button icon={<CopyOutlined />} onClick={copy}>
          Копировать
        </Button>
      </Flex>
      <Checkbox checked={saved} onChange={(e) => setSaved(e.target.checked)}>
        Я сохранил ключ в надёжном месте
      </Checkbox>
    </Modal>
  );
}
