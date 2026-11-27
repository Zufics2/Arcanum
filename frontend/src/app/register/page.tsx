"use client";

import { Alert, Button, Checkbox, Form, Input, Typography } from "antd";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import AuthCard from "@/components/AuthCard";
import { apiErrorMessage } from "@/lib/api";
import { register } from "@/lib/auth";

interface RegisterForm {
  username: string;
  password: string;
  confirm: string;
  understood: boolean;
}

export default function RegisterPage() {
  const router = useRouter();
  const [form] = Form.useForm<RegisterForm>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async ({ username, password }: RegisterForm) => {
    setLoading(true);
    setError(null);
    try {
      await register(username, password);
      router.replace("/drive");
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 400 && err.response.data?.username) {
        form.setFields([{ name: "username", errors: ["Этот логин уже занят"] }]);
      } else {
        setError(apiErrorMessage(err));
      }
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Регистрация">
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 24 }}
        title="Пароль нельзя восстановить"
        description="Файлы шифруются вашим паролем прямо в браузере. Сервер его не знает, поэтому если вы забудете пароль, данные будут потеряны навсегда."
      />
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false} disabled={loading}>
        <Form.Item
          name="username"
          label="Логин"
          rules={[
            { required: true, message: "Введите логин" },
            { min: 3, max: 150, message: "От 3 до 150 символов" },
            { pattern: /^[\w.@+-]+$/, message: "Только буквы, цифры и символы . @ + - _" },
          ]}
        >
          <Input autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item
          name="password"
          label="Пароль"
          rules={[
            { required: true, message: "Введите пароль" },
            { min: 8, message: "Минимум 8 символов" },
          ]}
          hasFeedback
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="Повторите пароль"
          dependencies={["password"]}
          hasFeedback
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
        <Form.Item
          name="understood"
          valuePropName="checked"
          rules={[
            {
              validator: (_, value) =>
                value ? Promise.resolve() : Promise.reject(new Error("Подтвердите, что поняли предупреждение")),
            },
          ]}
        >
          <Checkbox>Я понимаю, что пароль нельзя восстановить</Checkbox>
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          {loading ? "Генерируем ключи…" : "Зарегистрироваться"}
        </Button>
      </Form>
      <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
        Уже есть аккаунт? <Link href="/login">Войти</Link>
      </Typography.Paragraph>
    </AuthCard>
  );
}
