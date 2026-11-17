import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, Sarabun } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  variable: "--font-ui",
  display: "swap",
});

const sarabun = Sarabun({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  variable: "--font-doc",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CRIC E-Docx | ระบบร่างเอกสารราชการออนไลน์ วิทยาลัยการอาชีพเชียงราย",
  description: "ระบบร่าง ตรวจทาน เสนอลงนาม และทะเบียนคุมหนังสือราชการออนไลน์ตามระเบียบงานสารบรรณ พ.ศ. ๒๕๒๖",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${ibmPlexSansThai.variable} ${sarabun.variable}`}>
      <body className={`${ibmPlexSansThai.className} min-h-screen antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
