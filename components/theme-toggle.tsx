"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const msg = useTranslations("theme");
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("financial-planner-theme", next ? "dark" : "light");
    } catch {
      // ignore storage errors
    }
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label={msg("toggle")}
      title={msg("hint")}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
