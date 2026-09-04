"use client";

// Thin per-engine dispatcher (Task 7 split). The actual editor bodies live
// in param-sandbox-editor.tsx and branching-editor.tsx; this file only
// picks between them by `engineId` so page.tsx (a server component) has one
// stable import regardless of which engine an interactive uses.
import { ParamSandboxEditor, type EConfig as ParamSandboxConfig } from "./param-sandbox-editor";
import { BranchingEditor, type EBranchingConfig } from "./branching-editor";
import { CaseEditor, type ECaseConfig } from "./case-editor";
import { ProcessEditor, type EProcessConfig } from "./process-editor";
import type { AssetRef } from "./editor-shared";

export function Editor({ engineId, interactiveId, initialTitle, initialConfig, assets }: {
  engineId: string; interactiveId: string; initialTitle: string; initialConfig: unknown; assets: AssetRef[];
}) {
  if (engineId === "param-sandbox") {
    return (
      <ParamSandboxEditor
        interactiveId={interactiveId}
        initialTitle={initialTitle}
        initialConfig={initialConfig as ParamSandboxConfig}
        assets={assets}
      />
    );
  }
  if (engineId === "branching-scenario") {
    return (
      <BranchingEditor
        interactiveId={interactiveId}
        initialTitle={initialTitle}
        initialConfig={initialConfig as EBranchingConfig}
        assets={assets}
      />
    );
  }
  if (engineId === "case-workspace") {
    return (
      <CaseEditor
        interactiveId={interactiveId}
        initialTitle={initialTitle}
        initialConfig={initialConfig as ECaseConfig}
        assets={assets}
      />
    );
  }
  if (engineId === "process-simulator") {
    return (
      <ProcessEditor
        interactiveId={interactiveId}
        initialTitle={initialTitle}
        initialConfig={initialConfig as EProcessConfig}
        assets={assets}
      />
    );
  }
  // Defensive fallback: a data-integrity problem (unrecognized/corrupt
  // engineId), not something reachable through normal use of the app — the
  // "New interactive" form only ever writes an id ENGINE_ADAPTERS knows.
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      This interactive uses an unrecognized engine (&quot;{engineId}&quot;) and can&apos;t be edited here.
    </div>
  );
}
