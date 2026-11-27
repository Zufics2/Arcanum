"use client";

import { useQuery } from "@tanstack/react-query";
import { Tag } from "antd";
import axios from "axios";

import { API_URL } from "@/lib/config";

export default function BackendStatus() {
  const { isPending, isError } = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await axios.get<{ status: string }>(`${API_URL}/health/`)).data,
  });

  if (isPending) return <Tag>API: checking…</Tag>;
  if (isError) return <Tag color="error">API: unavailable</Tag>;
  return <Tag color="success">API: online</Tag>;
}
