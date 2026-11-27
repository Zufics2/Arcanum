"use client";

import { LockOutlined } from "@ant-design/icons";
import { Flex, Result } from "antd";

import BackendStatus from "@/components/BackendStatus";

export default function Home() {
  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <Result
        icon={<LockOutlined />}
        title="Arcanum"
        subTitle="Облачное хранилище с нулевым разглашением"
        extra={<BackendStatus />}
      />
    </Flex>
  );
}
