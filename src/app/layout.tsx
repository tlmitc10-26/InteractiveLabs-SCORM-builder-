import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Interactive Lesson Builder",
  description: "Build concept-experimentation interactives and export SCORM packages for Canvas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: browser extensions (screen recorders, password
    // managers, Grammarly, etc.) inject attributes into <html>/<body> before
    // React hydrates, which otherwise triggers a loud dev-mode mismatch
    // warning. It suppresses ATTRIBUTE mismatches on this element only —
    // real content mismatches still surface. No external fonts: system font
    // stack only, so the app makes zero third-party requests.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <header className="app-header">Interactive Lesson Builder</header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
