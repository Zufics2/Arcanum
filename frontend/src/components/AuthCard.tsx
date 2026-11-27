"use client";

import { LockOutlined } from "@ant-design/icons";
import { Card, Flex, Typography } from "antd";
import type { ReactNode } from "react";

export default function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh", padding: 16 }}>
      <Card style={{ width: "100%", maxWidth: 400 }}>
        <Flex vertical align="center" gap={4} style={{ marginBottom: 24 }}>
          <LockOutlined style={{ fontSize: 32, color: "#4f46e5" }} />
          <Typography.Title level={3} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
        </Flex>
        {children}
      </Card>
    </Flex>
  );
}
