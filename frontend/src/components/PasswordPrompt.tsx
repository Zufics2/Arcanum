"use client";

import { Form, Input, Modal } from "antd";
import { useState, type ReactNode } from "react";

import { hasFieldError } from "@/lib/api";

interface PasswordPromptProps {
  title: string;
  okText: string;
  description?: ReactNode;
  danger?: boolean;
  /** Should throw on failure; a wrong password is shown under the field. */
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}

/** Re-asks the current password for sensitive actions. Mount only while open. */
export default function PasswordPrompt({ title, okText, description, danger, onSubmit, onClose }: PasswordPromptProps) {
  const [form] = Form.useForm<{ password: string }>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const { password } = await form.validateFields();
    setLoading(true);
    try {
      await onSubmit(password);
    } catch (err) {
      if (hasFieldError(err, "auth_hash")) form.setFields([{ name: "password", errors: ["Неверный пароль"] }]);
      setLoading(false);
      return;
    }
    setLoading(false);
  };

  return (
    <Modal
      open
      title={title}
      okText={okText}
      cancelText="Отмена"
      okButtonProps={{ danger }}
      confirmLoading={loading}
      onOk={submit}
      onCancel={onClose}
    >
      {description}
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} style={{ marginTop: 16 }}>
        <Form.Item name="password" label="Текущий пароль" rules={[{ required: true, message: "Введите пароль" }]}>
          <Input.Password autoComplete="current-password" autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}
