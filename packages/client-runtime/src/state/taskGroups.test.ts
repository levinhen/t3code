import { EnvironmentId, type OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { v2ShellSnapshot, v2TaskGroup } from "./orchestrationV2TestFixtures.ts";
import { createEnvironmentTaskGroupAtoms } from "./taskGroups.ts";

it("scopes groups by environment and follows replacement snapshots and catalog removal", () => {
  const local = EnvironmentId.make("local");
  const remote = EnvironmentId.make("remote");
  const catalog = {
    isReady: true,
    entries: new Map(
      [local, remote].map((environmentId) => [
        environmentId,
        {
          target: new PrimaryConnectionTarget({
            environmentId,
            label: environmentId,
            httpBaseUrl: `https://${environmentId}.example.test`,
            wsBaseUrl: `wss://${environmentId}.example.test`,
          }),
          profile: Option.none(),
          enabled: true,
        },
      ]),
    ),
  };
  const catalogValueAtom = Atom.make<EnvironmentCatalogState>(catalog);
  const snapshotAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<OrchestrationV2ShellSnapshot | null>(null),
  );
  const { taskGroupAtom, taskGroupsAtom } = createEnvironmentTaskGroupAtoms({
    catalogValueAtom,
    snapshotAtom,
  });
  const registry = AtomRegistry.make();
  try {
    registry.mount(taskGroupsAtom);
    registry.set(snapshotAtom(local), { ...v2ShellSnapshot, taskGroups: [v2TaskGroup] });
    const remoteGroup = { ...v2TaskGroup, title: "Remote group" };
    const remoteSnapshot = { ...v2ShellSnapshot, taskGroups: [remoteGroup] };
    registry.set(snapshotAtom(remote), remoteSnapshot);
    const both = registry.get(taskGroupsAtom);
    const localGroupAtom = taskGroupAtom({ environmentId: local, taskGroupId: v2TaskGroup.id });
    const remoteGroupAtom = taskGroupAtom({ environmentId: remote, taskGroupId: v2TaskGroup.id });
    expect(both.map((group) => group.environmentId)).toEqual([local, remote]);
    expect(registry.get(localGroupAtom)).toBe(both[0]);
    expect(registry.get(remoteGroupAtom)).toBe(both[1]);

    registry.set(snapshotAtom(remote), { ...remoteSnapshot, snapshotSequence: 1 });
    expect(registry.get(taskGroupsAtom)).toBe(both);
    registry.set(snapshotAtom(local), v2ShellSnapshot);
    expect(registry.get(localGroupAtom)).toBeNull();
    expect(registry.get(taskGroupsAtom)[0]).toBe(both[1]);

    registry.set(catalogValueAtom, { ...catalog, entries: new Map() });
    expect(registry.get(taskGroupsAtom)).toEqual([]);
  } finally {
    registry.dispose();
  }
});
