"use client";

import { Alert, Button, Form, Input, Typography } from "antd";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import AuthCard from "@/components/AuthCard";
import { apiErrorMessage } from "@/lib/api";
import { recoverAccount } from "@/lib/auth";
import { InvalidRecoveryKeyError, parseRecoveryKey } from "@/lib/crypto";
import { useAuthStore } from "@/stores/authStore";

interface RecoverForm {
  username: string;
  recoveryKey: string;
  password: string;
  confirm: string;
}

export default function RecoverPage() {
  const router = useRouter();
  const lockedUsername = useAuthStore((s) => s.locked?.username);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async ({ username, recoveryKey, password }: RecoverForm) => {
    setLoading(true);
    setError(null);
    try {
      await recoverAccount(username, recoveryKey, password);
      router.replace("/drive");
    } catch (err) {
      setError(
        axios.isAxiosError(err) && err.response?.status === 401
          ? "Неверный логин или ключ восстановления"
          : apiErrorMessage(err),
      );
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Восстановление доступа">
      <Typography.Paragraph type="secondary">
        Введите ключ восстановления, который вы сохранили при его создании, и задайте новый пароль. Файлы останутся на
        месте.
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form
        layout="vertical"
        onFinish={onFinish}
        requiredMark={false}
        disabled={loading}
        initialValues={{ username: lockedUsername }}
      >
        <Form.Item name="username" label="Логин" rules={[{ required: true, message: "Введите логин" }]}>
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="recoveryKey"
          label="Ключ восстановления"
          rules={[
            { required: true, message: "Введите ключ" },
            {
              validator: (_, value) => {
                if (!value) return Promise.resolve();
                try {
                  parseRecoveryKey(value);
                  return Promise.resolve();
                } catch (e) {
                  return Promise.reject(
                    new Error(e instanceof InvalidRecoveryKeyError ? "Ключ состоит из 52 символов (A–Z, 2–7)" : "Неверный ключ"),
                  );
                }
              },
            },
          ]}
        >
          <Input.TextArea
            autoSize={{ minRows: 2 }}
            placeholder="XXXX-XXXX-XXXX-…"
            spellCheck={false}
            autoComplete="off"
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          />
        </Form.Item>
        <Form.Item
          name="password"
          label="Новый пароль"
          hasFeedback
          rules={[
            { required: true, message: "Введите новый пароль" },
            { min: 8, message: "Минимум 8 символов" },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="Повторите пароль"
          hasFeedback
          dependencies={["password"]}
          rules={[
            { required: true, message: "Повторите пароль" },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || getFieldValue("password") === value
                  ? Promise.resolve()
                  : Promise.reject(new Error("Пароли не совпадают")),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          {loading ? "Восстанавливаем доступ…" : "Задать новый пароль"}
        </Button>
      </Form>
      <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
        Вспомнили пароль? <Link href="/login">Войти</Link>
      </Typography.Paragraph>
    </AuthCard>
  );
}
