"use client";

import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { CSSProperties } from "react";

import { useThemeStore } from "@/stores/themeStore";

export default function ThemeToggle({ style }: { style?: CSSProperties }) {
  const mode = useThemeStore((s) => s.mode);
  const toggle = useThemeStore((s) => s.toggle);
  const label = mode === "dark" ? "Светлая тема" : "Тёмная тема";

  return (
    <Tooltip title={label}>
      <Button
        shape="circle"
        icon={mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggle}
        aria-label={label}
        style={style}
      />
    </Tooltip>
  );
}
