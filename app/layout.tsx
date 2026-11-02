import "./globals.css";
import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";

// Brand typeface (see AGENTS.md → Typography). Exposed as --font-sans for Tailwind's font-sans / font-heading.
const openSans = Open_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: {
    default: "Next.js Premium Startup Boilerplate",
    template: "%s · FastNextJS",
  },
  description: "Created using the ultimate interactive Next.js stack generator CLI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={openSans.variable}>
      <body style={{ margin: 0, padding: 0 }} className="antialiased">
        {children}
      </body>
    </html>
  );
}
