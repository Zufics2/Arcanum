"use client";

import { LockOutlined } from "@ant-design/icons";
import { Button, Flex, Result, Space } from "antd";
import Link from "next/link";

import BackendStatus from "@/components/BackendStatus";
import ThemeToggle from "@/components/ThemeToggle";

export default function Home() {
  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <ThemeToggle style={{ position: "fixed", top: 16, right: 16 }} />
      <Result
        icon={<LockOutlined />}
        title="Arcanum"
        subTitle="Облачное хранилище с нулевым разглашением"
        extra={
          <Flex vertical align="center" gap={16}>
            <Space>
              <Link href="/login">
                <Button type="primary">Войти</Button>
              </Link>
              <Link href="/register">
                <Button>Регистрация</Button>
              </Link>
            </Space>
            <BackendStatus />
          </Flex>
        }
      />
    </Flex>
  );
}
