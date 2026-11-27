import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useRef } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";
import { uuidv4 } from "../../lib/uuid";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { waitForThreadShell } from "./threadForkNavigation";
import { useOpenLinkedThread } from "./useOpenLinkedThread";

/**
 * Opens a main thread that carries a provider's own subagent's transcript, so the user can keep
 * talking to the work the subagent did. The subagent stays under its parent.
 */
export function useContinueSubagent() {
  const gt = useGT();
  const continueSubagent = useAtomCommand(threadEnvironment.continueSubagent, {
    reportFailure: false,
  });
  const openLinkedThread = useOpenLinkedThread();
  const pendingRef = useRef(false);
  const start = async (subagent: ScopedThreadRef, title: string) => {
    const targetThreadId = ThreadId.make(uuidv4());
    const result = await continueSubagent({
      environmentId: subagent.environmentId,
      input: {
        sourceThreadId: subagent.threadId,
        targetThreadId,
        title,
        creationSource: "mobile",
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        Dialog.alert(
          gt("Could not continue the subagent in a new thread"),
          errorDisplayMessage(squashAtomCommandFailure(result), m) ?? "",
        );
      }
      return;
    }
    if (!(await waitForThreadShell(scopeThreadRef(subagent.environmentId, targetThreadId)))) {
      Dialog.alert(
        gt("Could not continue the subagent in a new thread"),
        gt("The thread was created, but it did not reach this device."),
      );
      return;
    }
    openLinkedThread({ environmentId: subagent.environmentId, threadId: targetThreadId });
  };
  return async (subagent: ScopedThreadRef, title: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    await start(subagent, title).finally(() => {
      pendingRef.current = false;
    });
  };
}
