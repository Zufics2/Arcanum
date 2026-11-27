"use client";

import { EyeOutlined } from "@ant-design/icons";
import { Space, Switch, Tooltip, Typography } from "antd";

import { useUiStore } from "@/stores/uiStore";

export default function ServerViewToggle() {
  const serverView = useUiStore((s) => s.serverView);
  const setServerView = useUiStore((s) => s.setServerView);

  return (
    <Tooltip title="Показать файлы так, как они хранятся на сервере">
      <Space size={8} style={{ cursor: "pointer" }} onClick={() => setServerView(!serverView)}>
        <EyeOutlined />
        <Typography.Text>Глазами сервера</Typography.Text>
        <Switch size="small" checked={serverView} aria-label="Глазами сервера" />
      </Space>
    </Tooltip>
  );
}
