
import { documentModelContext, executeNamedTool, TOOL_DEFS } from "./tools";

export function registerPlaneTools(): () => void {
  const mc = documentModelContext();
  if (!mc || typeof mc.registerTool !== "function") {
    return () => {};
  }

  const controller = new AbortController();
  const { signal } = controller;

  for (const def of TOOL_DEFS) {
    void mc
      .registerTool(
        {
          name: def.name,
          description: def.description,
          inputSchema: def.inputSchema,
          annotations: def.annotations,
          execute: async (input) => executeNamedTool(def.name, input),
        },
        { signal },
      )
      .catch((error: unknown) => {
        if (signal.aborted) return;
        console.warn(`registerTool(${def.name}) failed`, error);
      });
  }

  return () => controller.abort();
}
