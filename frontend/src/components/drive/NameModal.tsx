"use client";

import { Form, Input, Modal } from "antd";
import { useState } from "react";

interface NameModalProps {
  title: string;
  okText: string;
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

/** Asks for a folder/file name. Mount it only while open, so the form starts fresh each time. */
export default function NameModal({ title, okText, initialName = "", onSubmit, onClose }: NameModalProps) {
  const [form] = Form.useForm<{ name: string }>();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const { name } = await form.validateFields();
    setSaving(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={title} okText={okText} cancelText="Отмена" onOk={submit} onCancel={onClose} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ name: initialName }} onFinish={submit}>
        <Form.Item
          name="name"
          rules={[
            { required: true, whitespace: true, message: "Введите имя" },
            { max: 255, message: "Не длиннее 255 символов" },
            { pattern: /^[^/\\]*$/, message: "Имя не может содержать / или \\" },
          ]}
        >
          <Input autoFocus maxLength={255} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
