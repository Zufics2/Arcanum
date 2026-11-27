"use client";

import { Alert, Button, Flex, Form, Input, Spin, Typography } from "antd";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import AuthCard from "@/components/AuthCard";
import UserAvatar from "@/components/UserAvatar";
import { apiErrorMessage } from "@/lib/api";
import { forgetLockedSession, login } from "@/lib/auth";
import { useAuthStore } from "@/stores/authStore";

export default function UnlockPage() {
  const router = useRouter();
  const locked = useAuthStore((s) => s.locked);
  const restoring = useAuthStore((s) => s.restoring);
  const session = useAuthStore((s) => s.session);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (restoring) return;
    if (session) router.replace("/drive");
    else if (!locked) router.replace("/login");
  }, [restoring, session, locked, router]);

  if (!locked) return <Spin fullscreen />;

  const onFinish = async ({ password }: { password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await login(locked.username, password);
      const { returnTo, setReturnTo } = useAuthStore.getState();
      setReturnTo(null);
      router.replace(returnTo ?? "/drive");
    } catch (err) {
      setError(axios.isAxiosError(err) && err.response?.status === 401 ? "Неверный пароль" : apiErrorMessage(err));
      setLoading(false);
    }
  };

  const onOtherAccount = async () => {
    await forgetLockedSession();
    router.replace("/login");
  };

  return (
    <AuthCard title="Хранилище заблокировано">
      <Flex vertical align="center" gap={8} style={{ marginBottom: 24 }}>
        <UserAvatar username={locked.username} defaultAvatar={locked.defaultAvatar} size={72} />
        <Typography.Text strong style={{ fontSize: 16 }}>
          {locked.username}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ textAlign: "center" }}>
          Ключи шифрования хранятся только в памяти и стираются при перезагрузке. Введите пароль, чтобы расшифровать их снова.
        </Typography.Text>
      </Flex>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form layout="vertical" onFinish={onFinish} requiredMark={false} disabled={loading}>
        {/* Hidden username helps password managers fill the right entry. */}
        <input type="text" name="username" autoComplete="username" value={locked.username} readOnly hidden />
        <Form.Item name="password" label="Пароль" rules={[{ required: true, message: "Введите пароль" }]}>
          <Input.Password autoComplete="current-password" autoFocus />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          {loading ? "Расшифровываем ключи…" : "Разблокировать"}
        </Button>
      </Form>
      <Flex justify="space-between" style={{ marginTop: 8 }}>
        <Link href="/recover">Забыли пароль?</Link>
        <Typography.Link onClick={onOtherAccount}>Войти в другой аккаунт</Typography.Link>
      </Flex>
    </AuthCard>
  );
}
