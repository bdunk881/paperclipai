export type WorkflowBuilderMode = "edit" | "readonly";

export function buildWorkflowBuilderRoute(
  templateId: string,
  options?: {
    popout?: boolean;
    mode?: WorkflowBuilderMode;
    from?: string;
  }
): string {
  const params = new URLSearchParams();

  if (options?.popout) {
    params.set("popout", "1");
  }

  if (options?.mode && options.mode !== "edit") {
    params.set("mode", options.mode);
  }

  if (options?.from) {
    params.set("from", options.from);
  }

  const query = params.toString();
  return query ? `/builder/${templateId}?${query}` : `/builder/${templateId}`;
}
