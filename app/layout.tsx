import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/shell/Providers";

export const metadata: Metadata = {
  title: "PlantLens — factory maintenance and recovery workbench",
  description: "Software-first factory maintenance and recovery workbench. Fictional demo plant; simulation, not a live factory connection.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#121316" },
  ],
  width: "device-width",
  initialScale: 1,
};

const themeScript = `(function(){try{var t=localStorage.getItem("plantlens.theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");if(localStorage.getItem("plantlens.reducedMotion")==="1")document.documentElement.setAttribute("data-reduced-motion","1");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
