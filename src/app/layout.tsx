import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "OKBrain - Your Personal AI Assistant",
  description: "A private AI chat application that keeps your data with you",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "OKBrain",
  },
  icons: {
    icon: "/okbrain-icon.png",
    apple: "/okbrain-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover", // Support safe area insets on iOS devices
  themeColor: "#343541",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read sidebar width from cookies on the server for SSR
  const cookieStore = await cookies();
  const savedWidth = cookieStore.get('sidebarWidth')?.value;
  const sidebarWidth = savedWidth && !isNaN(parseInt(savedWidth))
    ? Math.min(Math.max(parseInt(savedWidth), 200), 600)
    : 280;

  return (
    <html lang="en">
      <head>
        <style>{`:root { --sidebar-width: ${sidebarWidth}px; }`}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
