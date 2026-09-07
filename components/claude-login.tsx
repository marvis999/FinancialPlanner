"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, CircleDashed, ExternalLink, Loader2, LogIn } from "lucide-react";

import {
  cancelClaudeLoginAction,
  finishClaudeLoginAction,
  getClaudeAuthAction,
  startClaudeLoginAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/section-heading";
import type { ClaudeAuthStatus } from "@/lib/types";

/**
 * Sign the server's Claude CLI in without a terminal: start the CLI's login,
 * open the link it prints, paste the code the page shows. The status line is
 * read from `claude auth status` on mount and after every attempt.
 */
export function ClaudeLoginCard({ disabled }: { disabled: boolean }) {
  const msg = useTranslations("claudeLogin");
  const msgCommon = useTranslations("common");
  // undefined = not checked yet, null = the CLI could not be asked.
  const [status, setStatus] = React.useState<ClaudeAuthStatus | null | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const res = await getClaudeAuthAction();
    setStatus(res.status);
    setError(res.error);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await startClaudeLoginAction();
      setUrl(res.url);
      setError(res.error);
    } finally {
      setBusy(false);
    }
  }

  async function finish(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await finishClaudeLoginAction(code);
      if (res.status) {
        setStatus(res.status);
        setUrl(null);
        setCode("");
      } else {
        setError(res.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    await cancelClaudeLoginAction();
    setUrl(null);
    setCode("");
    setError(null);
  }

  const statusLine =
    status === undefined ? (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {msg("checking")}
      </span>
    ) : status?.loggedIn ? (
      <span className="inline-flex items-center gap-1.5">
        <CircleCheck className="h-3.5 w-3.5 text-success" />
        {status.email ? msg("signedIn", { email: status.email }) : msg("signedInNoEmail")}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <CircleDashed className="h-3.5 w-3.5" />
        {msg("signedOut")}
      </span>
    );

  return (
    <section>
      <SectionHeading title={msg("title")} description={msg("description")} />
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            {statusLine}
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy}>
                {msg("refresh")}
              </Button>
              {!url && !status?.loggedIn && (
                <Button size="sm" onClick={() => void start()} disabled={busy || disabled}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                  {msg("signIn")}
                </Button>
              )}
            </div>
          </div>

          {url && (
            <form onSubmit={finish} className="space-y-2 rounded-lg border border-dashed px-4 py-3">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-2 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {msg("openPage")}
              </a>
              <p className="text-xs text-muted-foreground">{msg("pasteHint")}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder={msg("codePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
                <Button type="submit" disabled={busy || !code.trim()}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {msg("finish")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => void cancel()} disabled={busy}>
                  {msgCommon("cancel")}
                </Button>
              </div>
            </form>
          )}

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
