"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Eye, ShieldCheck } from "lucide-react";

import { setClaudeEnabledAction, setHiddenNamesAction } from "@/app/actions";
import { ClaudePreviewDialog } from "@/components/claude-preview-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SectionHeading } from "@/components/ui/section-heading";
import { Switch } from "@/components/ui/switch";
import type { ClaudePrivacy } from "@/lib/types";

/**
 * The switch that decides whether anything is sent to Claude, and the names
 * hidden from it. The server enforces both; this only edits them.
 */
export function ClaudePrivacyCard({
  privacy,
  onChange,
}: {
  privacy: ClaudePrivacy;
  onChange: (next: ClaudePrivacy) => void;
}) {
  const msg = useTranslations("claudePrivacy");
  const msgCommon = useTranslations("common");
  const [names, setNames] = React.useState(privacy.hiddenNames.join("\n"));
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const savedNames = privacy.hiddenNames.join("\n");

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      onChange(await setClaudeEnabledAction(enabled));
    } finally {
      setBusy(false);
    }
  }

  async function saveNames(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const next = await setHiddenNamesAction(names);
      onChange(next);
      // Show the list as stored: trimmed, without blanks and duplicates.
      setNames(next.hiddenNames.join("\n"));
      setSaved(true);
    } finally {
      setBusy(false);
    }
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

          <form onSubmit={saveNames} className="space-y-2">
            <Label htmlFor="claude-hidden-names" className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
              {msg("namesLabel")}
            </Label>
            <p id="claude-hidden-names-hint" className="text-xs text-muted-foreground">
              {msg("namesHint")}
            </p>
            <textarea
              id="claude-hidden-names"
              aria-describedby="claude-hidden-names-hint"
              value={names}
              onChange={(event) => {
                setNames(event.target.value);
                setSaved(false);
              }}
              placeholder={msg("namesPlaceholder")}
              rows={4}
              className="w-full max-w-md resize-y rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                variant="secondary"
                disabled={busy || names === savedNames}
              >
                {msgCommon("save")}
              </Button>
              {saved && (
                <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  {msg("saved")}
                </span>
              )}
            </div>
          </form>

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
