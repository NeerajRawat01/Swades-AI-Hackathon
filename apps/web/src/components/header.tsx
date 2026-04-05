"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ModeToggle } from "./mode-toggle";

export default function Header() {
  const pathname = usePathname();

  const links = [{ to: "/", label: "Home" }] as const;

  return (
    <header className="border-border/60 border-b bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="font-[family-name:var(--font-space-grotesk)] text-base font-semibold tracking-tight"
        >
          Swades AI
        </Link>
        <nav
          className="flex items-center gap-2 rounded-full border border-border/70 bg-card/70 p-1"
          aria-label="Main Navigation"
        >
          {links.map(({ to, label }) => {
            const isActive = pathname === to;
            return (
              <Link
                key={to}
                href={to}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center">
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
