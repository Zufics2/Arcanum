"use client";

import {
  CheckOutlined,
  DownOutlined,
  KeyOutlined,
  PlusOutlined,
  RightOutlined,
  SettingOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { App, Button, Divider, Flex, Popover, Progress, Tag, Typography, theme } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import UserAvatar from "@/components/UserAvatar";
import { useCustomAvatarUrl, useMe } from "@/hooks/useProfile";
import { apiErrorMessage } from "@/lib/api";
import { logout, switchAccount } from "@/lib/auth";
import { formatBytes } from "@/lib/format";
import { useAuthStore } from "@/stores/authStore";

import { version } from "../../package.json";

function MenuRow({ icon, children, extra, onClick }: { icon: ReactNode; children: ReactNode; extra?: ReactNode; onClick: () => void }) {
  return (
    <Button type="text" block onClick={onClick} style={{ height: 40, paddingInline: 8 }}>
      <Flex align="center" justify="space-between" style={{ width: "100%" }}>
        <Flex align="center" gap={10}>
          {icon}
          {children}
        </Flex>
        {extra}
      </Flex>
    </Button>
  );
}

export default function ProfileMenu() {
  const router = useRouter();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const session = useAuthStore((s) => s.session);
  const others = useAuthStore((s) => s.others);
  const { data: me } = useMe();
  const customUrl = useCustomAvatarUrl();
  const [open, setOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  if (!session) return null;

  const used = me?.storage_used ?? 0;
  const quota = me?.storage_quota ?? 0;
  const percent = quota ? Math.min(100, Math.round((used / quota) * 1000) / 10) : 0;
  const defaultAvatar = me?.default_avatar ?? session.defaultAvatar;

  const close = () => {
    setOpen(false);
    setSwitchOpen(false);
  };

  const go = (path: string) => {
    close();
    router.push(path);
  };

  const onSwitch = async (username: string) => {
    close();
    try {
      await switchAccount(username);
      router.push("/drive");
    } catch (err) {
      message.error(`Сессия ${username} истекла, войдите заново. ${apiErrorMessage(err, "")}`);
    }
  };

  const onLogout = async () => {
    close();
    await logout();
  };

  const content = (
    <Flex vertical gap={12} style={{ width: 300 }}>
      <Flex align="center" gap={12}>
        <UserAvatar username={session.username} defaultAvatar={defaultAvatar} customUrl={customUrl} size={56} />
        <Flex vertical style={{ minWidth: 0 }}>
          <Typography.Text strong ellipsis style={{ fontSize: 16 }}>
            {session.username}
          </Typography.Text>
          <Link href="/settings" onClick={close}>
            Настройки профиля
          </Link>
        </Flex>
      </Flex>

      <div>
        <Flex justify="space-between">
          <Typography.Text type="secondary">Хранилище</Typography.Text>
          <Typography.Text>
            {me ? `${formatBytes(used)} из ${formatBytes(quota)}` : "…"}
          </Typography.Text>
        </Flex>
        <Progress percent={percent} showInfo={false} size="small" status={percent >= 90 ? "exception" : "normal"} />
      </div>

      <Divider style={{ margin: 0 }} />

      <Flex vertical gap={2}>
        <MenuRow
          icon={<KeyOutlined />}
          extra={me && !me.has_recovery_key ? <Tag color="warning" style={{ margin: 0 }}>не создан</Tag> : undefined}
          onClick={() => go("/settings#recovery")}
        >
          Ключ восстановления
        </MenuRow>
        <MenuRow icon={<SettingOutlined />} onClick={() => go("/settings")}>
          Настройки
        </MenuRow>
        <MenuRow
          icon={<SwapOutlined />}
          extra={switchOpen ? <DownOutlined /> : <RightOutlined />}
          onClick={() => setSwitchOpen((v) => !v)}
        >
          Переключить аккаунт
        </MenuRow>
        {switchOpen && (
          <Flex vertical gap={2} style={{ paddingLeft: 16, borderLeft: `2px solid ${token.colorBorderSecondary}`, marginLeft: 14 }}>
            <MenuRow
              icon={<UserAvatar username={session.username} defaultAvatar={defaultAvatar} customUrl={customUrl} size={24} />}
              extra={<CheckOutlined style={{ color: token.colorPrimary }} />}
              onClick={close}
            >
              {session.username}
            </MenuRow>
            {others.map((o) => (
              <MenuRow
                key={o.username}
                icon={<UserAvatar username={o.username} defaultAvatar={o.defaultAvatar} size={24} />}
                onClick={() => onSwitch(o.username)}
              >
                {o.username}
              </MenuRow>
            ))}
            <MenuRow icon={<PlusOutlined />} onClick={() => go("/login")}>
              Добавить аккаунт
            </MenuRow>
          </Flex>
        )}
      </Flex>

      <Button size="large" block onClick={onLogout}>
        Выйти
      </Button>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Arcanum v{version}
      </Typography.Text>
    </Flex>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : close())}
    >
      {/* A plain button: antd's Button + Avatar misalign inside the 64px-line-height header. */}
      <button
        type="button"
        aria-label="Профиль"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          border: `2px solid ${open ? token.colorPrimary : "transparent"}`,
          borderRadius: "50%",
          background: "transparent",
          cursor: "pointer",
          lineHeight: 0,
        }}
      >
        <UserAvatar username={session.username} defaultAvatar={defaultAvatar} customUrl={customUrl} size={36} />
      </button>
    </Popover>
  );
}
