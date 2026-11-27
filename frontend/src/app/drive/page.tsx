"use client";

import { Button, Flex, Result } from "antd";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuthStore } from "@/stores/authStore";

// Placeholder until stage 3 (files and folders).
export default function DrivePage() {
  const router = useRouter();
  const username = useAuthStore((s) => s.username);
  const masterKey = useAuthStore((s) => s.masterKey);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    // The key exists only in memory: after a reload the user has to log in again.
    if (!masterKey) router.replace("/login");
  }, [masterKey, router]);

  if (!masterKey) return null;

  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <Result
        status="success"
        title={`Вы вошли как ${username}`}
        subTitle="Ключ шифрования расшифрован и хранится только в памяти браузера. Диск появится на следующем этапе."
        extra={<Button onClick={logout}>Выйти</Button>}
      />
    </Flex>
  );
}
