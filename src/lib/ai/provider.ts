/** Generation provider seam. v1 ships NullProvider: no key, no calls, no AI UI.
 *  The future CreateAI implementation must return schema-shaped JSON only;
 *  callers ALWAYS revalidate with validateSandboxConfig before use. */
export interface GenerationProvider {
  readonly enabled: boolean;
  draftContent(engineId: string, brief: string): Promise<unknown>;
  refineContent(engineId: string, config: unknown, instruction: string): Promise<unknown>;
}

class NullProvider implements GenerationProvider {
  readonly enabled = false;
  async draftContent(): Promise<unknown> {
    throw new Error("AI generation is not enabled in this build");
  }
  async refineContent(): Promise<unknown> {
    throw new Error("AI generation is not enabled in this build");
  }
}

export function getGenerationProvider(): GenerationProvider {
  return new NullProvider();
}
