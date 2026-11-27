"use client";

import { LockOutlined } from "@ant-design/icons";
import { Card, Flex, Typography, theme } from "antd";
import type { ReactNode } from "react";

import ThemeToggle from "@/components/ThemeToggle";

export default function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  const { token } = theme.useToken();

  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh", padding: 16 }}>
      <ThemeToggle style={{ position: "fixed", top: 16, right: 16 }} />
      <Card style={{ width: "100%", maxWidth: 400 }}>
        <Flex vertical align="center" gap={4} style={{ marginBottom: 24 }}>
          <LockOutlined style={{ fontSize: 32, color: token.colorPrimary }} />
          <Typography.Title level={3} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
        </Flex>
        {children}
      </Card>
    </Flex>
  );
}
