"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, ShieldCheck } from "lucide-react";

import { previewClaudePromptAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PLACEHOLDER } from "@/lib/pii-mask";
import type { ClaudePreview, ClaudePreviewKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const KINDS: ClaudePreviewKind[] = ["import", "categories", "question"];

/** The prompt with every placeholder highlighted, so the masking is visible at a glance. */
function HighlightedPrompt({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  // matchAll works on a copy of the regex, so the shared one keeps no state.
  for (const match of text.matchAll(PLACEHOLDER)) {
    const start = match.index ?? 0;
    parts.push(text.slice(last, start));
    parts.push(
      <mark key={start} className="rounded bg-primary/25 px-0.5 text-foreground">
        {match[0]}
      </mark>
    );
    last = start + match[0].length;
  }
  parts.push(text.slice(last));

  // The fixed instructions come first; start at the first hidden value instead.
  const box = React.useRef<HTMLPreElement>(null);
  React.useEffect(() => {
    const pre = box.current;
    const first = pre?.querySelector("mark");
    // The box is `relative`, so a mark's offsetTop is measured from the box itself.
    if (pre) pre.scrollTop = first ? first.offsetTop - 48 : 0;
  }, [text]);

  return (
    <pre ref={box} className="relative max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg [overflow-wrap:anywhere] border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      {parts}
    </pre>
  );
}

/**
 * Shows the exact text Claude would receive, built locally by the same code
 * as a real run. Nothing is sent from here.
 */
export function ClaudePreviewDialog({
  open,
  onOpenChange,
  enabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether Claude is switched on; when off the dialog says nothing would be sent yet. */
  enabled: boolean;
}) {
  const msg = useTranslations("claudePrivacy");
  const [kind, setKind] = React.useState<ClaudePreviewKind>("import");
  const [question, setQuestion] = React.useState("");
  const [preview, setPreview] = React.useState<ClaudePreview | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async (next: ClaudePreviewKind, asked: string) => {
    setLoading(true);
    try {
      setPreview(await previewClaudePromptAction(next, asked));
    } finally {
      setLoading(false);
    }
  }, []);

  // A fresh preview every time the dialog opens: the bookings or names may have changed.
  React.useEffect(() => {
    if (open) void load(kind, question);
    // Only on opening; switching kinds and "Update" load explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const kindLabel: Record<ClaudePreviewKind, string> = {
    import: msg("previewImport"),
    categories: msg("previewCategories"),
    question: msg("previewQuestion"),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{msg("previewTitle")}</DialogTitle>
          <DialogDescription>
            {msg("previewDescription")}
            {!enabled && <> {msg("previewOffNote")}</>}
          </DialogDescription>
        </DialogHeader>

        <div role="group" aria-label={msg("previewTitle")} className="inline-flex w-fit flex-wrap gap-1 rounded-xl bg-muted p-1">
          {KINDS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => {
                setKind(option);
                void load(option, question);
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                kind === option && "bg-background font-semibold text-foreground shadow-sm dark:bg-accent"
              )}
            >
              {kindLabel[option]}
            </button>
          ))}
        </div>

        {kind === "question" && (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load("question", question);
            }}
          >
            <Input
              aria-label={msg("previewQuestionLabel")}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={msg("previewQuestionPlaceholder")}
            />
            <Button type="submit" variant="secondary" disabled={loading}>
              {msg("previewUpdate")}
            </Button>
          </form>
        )}

        {loading && !preview ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {msg("previewLoading")}
          </p>
        ) : preview && !preview.ok ? (
          <p className="text-sm text-muted-foreground">{preview.error}</p>
        ) : preview ? (
          // min-w-0: the dialog is a grid, and a long JSON line would otherwise widen it past the screen.
          <div className={cn("min-w-0 space-y-3", loading && "opacity-60")} aria-busy={loading}>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
              {preview.hidden.length ? (
                <>
                  <span className="text-muted-foreground">{msg("previewHiddenLabel")}</span>
                  {preview.hidden.map(({ kind: hiddenKind, count }) => (
                    <span key={hiddenKind} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                      {msg(`hidden${hiddenKind}`, { count })}
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-muted-foreground">{msg("previewNothingHidden")}</span>
              )}
            </p>
            {preview.sample > 0 && (
              <p className="text-xs text-muted-foreground">
                {msg("previewImportNote", { count: preview.sample })}
              </p>
            )}
            <HighlightedPrompt text={preview.prompt} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
