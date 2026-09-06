import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wispo CMS",
  description: "Управление контентом сайтов Wispo",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
