
/// <reference types="webmcp-types" />

export {};

declare global {
  namespace WebMCP {
    interface ModelContextExecuteToolOptions {
      signal?: AbortSignal;
    }

    interface ModelContext {
      executeTool(
        tool: RegisteredTool,
        input?: object | string,
        options?: ModelContextExecuteToolOptions,
      ): Promise<string | null>;
    }
  }
}
