"use client";

import { LockOutlined } from "@ant-design/icons";
import { Flex, Layout, Space, Spin, Typography, theme } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import ProfileMenu from "@/components/ProfileMenu";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuthStore } from "@/stores/authStore";

/** Layout for pages that need unlocked keys: header + redirect to unlock/login when there are none. */
export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token } = theme.useToken();
  const session = useAuthStore((s) => s.session);
  const locked = useAuthStore((s) => s.locked);
  const restoring = useAuthStore((s) => s.restoring);

  useEffect(() => {
    if (restoring || session) return;
    // Keys exist only in memory: after a reload the user unlocks with the password.
    useAuthStore.getState().setReturnTo(pathname);
    router.replace(locked ? "/unlock" : "/login");
  }, [restoring, session, locked, pathname, router]);

  if (!session) {
    return <Spin fullscreen spinning={restoring} />;
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header
        style={{
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          paddingInline: 24,
          lineHeight: "normal", // antd's 64px line-height breaks vertical centering of the avatar
        }}
      >
        <Flex align="center" justify="space-between" style={{ height: "100%" }}>
          <Link href="/drive">
            <Space>
              <LockOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
              <Typography.Text strong style={{ fontSize: 18 }}>
                Arcanum
              </Typography.Text>
            </Space>
          </Link>
          <Flex align="center" gap={12}>
            <ThemeToggle />
            <ProfileMenu />
          </Flex>
        </Flex>
      </Layout.Header>
      <Layout.Content style={{ padding: 24, maxWidth: 1200, width: "100%", margin: "0 auto" }}>
        {children}
      </Layout.Content>
    </Layout>
  );
}
