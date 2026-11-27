import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { msg } from "gt-react";
import { useRef } from "react";

import { toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { newThreadId } from "../lib/utils";
import { waitForThreadShell } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { useStableCallback } from "./useStableCallback";

/**
 * Opens a main thread that carries a provider's own subagent's transcript, so the user can keep
 * talking to the work the subagent did. The subagent stays under its parent.
 */
export function useContinueSubagent() {
  const navigate = useNavigate();
  const continueSubagent = useAtomCommand(threadEnvironment.continueSubagent, {
    reportFailure: false,
  });
  const pendingRef = useRef(false);
  const failed = (description: string) =>
    toastManager.add({
      type: "error",
      title: m(msg("Could not continue the subagent in a new thread")),
      description,
    });
  const start = async (subagentRef: ScopedThreadRef, title: string) => {
    const targetThreadId = newThreadId();
    const result = await continueSubagent({
      environmentId: subagentRef.environmentId,
      input: { sourceThreadId: subagentRef.threadId, targetThreadId, title },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        failed(thrownErrorMessage(squashAtomCommandFailure(result), m) ?? "");
      }
      return;
    }
    const targetRef = scopeThreadRef(subagentRef.environmentId, targetThreadId);
    if (!(await waitForThreadShell(targetRef))) {
      failed(
        m(
          msg(
            "The thread was created, but it did not reach this client. Reconnect and open it from the sidebar.",
          ),
        ),
      );
      return;
    }
    await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(targetRef) });
  };
  const run = async (subagentRef: ScopedThreadRef, title: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    await start(subagentRef, title).finally(() => {
      pendingRef.current = false;
    });
  };
  return useStableCallback(run);
}
