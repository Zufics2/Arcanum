import type { ReactNode } from "react";

import AppShell from "@/components/AppShell";

export default function DriveLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
