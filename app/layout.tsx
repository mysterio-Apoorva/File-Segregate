import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "StudySort AI — Make room for understanding",
  description:
    "Turn a messy folder into an organized knowledge library. Content-first organization powered by Google Gemini.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
