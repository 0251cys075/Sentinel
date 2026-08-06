import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import { Providers } from "@/components/providers";
import { FcmRegistration } from "@/components/fcm-registration";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sentinel — Protection that never sleeps",
  description:
    "Sentinel watches over your journey in the background, so you can focus on getting where you're going.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0F6E56",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${poppins.variable}`}
    >
      <body className="font-sans">
        <Providers>
          <FcmRegistration />
          {children}
        </Providers>
      </body>
    </html>
  );
}
