import type { Metadata } from "next";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { apiGet } from "@/lib/api";
import type { DivisionOption } from "@/lib/divisions";
import "./globals.css";
import Nav from "./components/Nav";

export const metadata: Metadata = {
  title: "TDL Advanced Stats",
  description: "Players, teams, games, box scores, leaderboards, and division filters.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let divisions: DivisionOption[] = [];

  try {
    divisions = await apiGet<DivisionOption[]>("/divisions");
  } catch {
    divisions = [];
  }

  return (
    <html lang="en">
      <body className="antialiased bg-black text-white">
        <Suspense fallback={null}>
          <Nav divisions={divisions} />
        </Suspense>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
