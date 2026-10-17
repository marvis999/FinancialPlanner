"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Eye, Plus, ShieldCheck, X } from "lucide-react";

import { setClaudeEnabledAction, setHiddenNamesAction } from "@/app/actions";
import { ClaudePreviewDialog } from "@/components/claude-preview-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeading } from "@/components/ui/section-heading";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ClaudePrivacy } from "@/lib/types";

/** What lib/pii-mask.ts hides without being told; keep in step with it. */
const ALWAYS_HIDDEN = [
  "alwaysIban",
  "alwaysCards",
  "alwaysContact",
  "alwaysAddress",
  "alwaysReferences",
  "alwaysCodes",
] as const;

/**
 * The switch that decides whether anything is sent to Claude, what is always
 * hidden, and the names the user adds on top. The server enforces all of it;
 * this only edits the switch and the name list.
 */
export function ClaudePrivacyCard({
  privacy,
  onChange,
}: {
  privacy: ClaudePrivacy;
  onChange: (next: ClaudePrivacy) => void;
}) {
  const msg = useTranslations("claudePrivacy");
  const [name, setName] = React.useState("");
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      onChange(await setClaudeEnabledAction(enabled));
    } finally {
      setBusy(false);
    }
  }

  /** Whether the list was saved; on failure the reason is shown under the input. */
  async function saveNames(names: string[]): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    try {
      onChange(await setHiddenNamesAction(names.join("\n")));
      return true;
    } catch {
      setProblem(msg("namesSaveFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const entry = name.trim();
    // Same rules as the server (parseHiddenNames), said before the round trip.
    if (entry.length < 2) {
      setProblem(msg("namesTooShort"));
      return;
    }
    if (privacy.hiddenNames.some((existing) => existing.toLowerCase() === entry.toLowerCase())) {
      setProblem(msg("namesDuplicate", { name: entry }));
      return;
    }
    // Keep what was typed when the save fails, so it can be sent again.
    if (await saveNames([...privacy.hiddenNames, entry])) setName("");
  }

  return (
    <section>
      <SectionHeading title={msg("title")} description={msg("description")} />
      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex items-start gap-3">
            <Switch
              id="claude-enabled"
              checked={privacy.enabled}
              onCheckedChange={(checked) => void toggle(checked)}
              disabled={busy}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="claude-enabled">{msg("switchLabel")}</Label>
              <p className="text-sm text-muted-foreground">
                {privacy.enabled ? msg("onHint") : msg("offHint")}
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
              {msg("alwaysHiddenTitle")}
            </h3>
            <p className="text-xs text-muted-foreground">{msg("alwaysHiddenIntro")}</p>
            <ul className="flex flex-wrap gap-1.5">
              {ALWAYS_HIDDEN.map((key) => (
                <li key={key} className="rounded-md bg-background px-2 py-1 text-xs dark:bg-accent">
                  {msg(key)}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{msg("neverSent")}</p>
          </div>

          <div className="max-w-md space-y-2">
            <Label htmlFor="claude-hidden-name">{msg("namesLabel")}</Label>
            <p id="claude-hidden-names-hint" className="text-xs text-muted-foreground">
              {msg("namesHint")}
            </p>
            <form onSubmit={add} className="flex gap-2">
              <Input
                id="claude-hidden-name"
                aria-describedby="claude-hidden-names-hint"
                aria-invalid={problem !== null}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setProblem(null);
                }}
                placeholder={msg("namesPlaceholder")}
                maxLength={100}
              />
              <Button type="submit" variant="secondary" disabled={busy || !name.trim()}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                {msg("namesAdd")}
              </Button>
            </form>
            {problem && (
              <p role="alert" className="text-xs text-destructive">
                {problem}
              </p>
            )}
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{msg("namesColumn")}</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">{msg("namesActions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {privacy.hiddenNames.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-sm text-muted-foreground">
                        {msg("namesEmpty")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    privacy.hiddenNames.map((entry) => (
                      <TableRow key={entry}>
                        <TableCell className="font-medium">{entry}</TableCell>
                        <TableCell className="py-1 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={msg("namesRemove", { name: entry })}
                            onClick={() =>
                              void saveNames(privacy.hiddenNames.filter((existing) => existing !== entry))
                            }
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="mr-2 h-4 w-4" aria-hidden />
              {msg("previewButton")}
            </Button>
            <p className="text-xs text-muted-foreground">{msg("previewHint")}</p>
          </div>
        </CardContent>
      </Card>
      <ClaudePreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        enabled={privacy.enabled}
      />
    </section>
  );
}
