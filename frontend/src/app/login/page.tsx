"use client";

import { Alert, Button, Form, Input, Typography } from "antd";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import AuthCard from "@/components/AuthCard";
import { apiErrorMessage } from "@/lib/api";
import { login } from "@/lib/auth";

interface LoginForm {
  username: string;
  password: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async ({ username, password }: LoginForm) => {
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
      router.replace("/drive");
    } catch (err) {
      setError(
        axios.isAxiosError(err) && err.response?.status === 401
          ? "Неверный логин или пароль"
          : apiErrorMessage(err),
      );
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Вход">
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form layout="vertical" onFinish={onFinish} requiredMark={false} disabled={loading}>
        <Form.Item name="username" label="Логин" rules={[{ required: true, message: "Введите логин" }]}>
          <Input autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item name="password" label="Пароль" rules={[{ required: true, message: "Введите пароль" }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          {loading ? "Расшифровываем ключи…" : "Войти"}
        </Button>
      </Form>
      <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
        Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
      </Typography.Paragraph>
    </AuthCard>
  );
}
