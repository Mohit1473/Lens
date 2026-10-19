import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lens",
  description: "Lens: see who fits a role, and exactly why.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
