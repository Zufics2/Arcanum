import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";

import Providers from "@/components/Providers";

import "./globals.css";

export const metadata: Metadata = {
  title: "Arcanum",
  description: "Zero-knowledge cloud storage",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
