export async function runToolWithLogger<T>(
  toolName: string,
  queryOrArg: string,
  action: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  const truncatedArg = queryOrArg.length > 50 ? `${queryOrArg.slice(0, 47)}...` : queryOrArg;
  console.log(`\n┌── [AI_TOOL_RUNNER] ───────────────────`);
  console.log(`│ ❯ [RUNNING] [${toolName}] "${truncatedArg}" در حال اجرا...`);

  try {
    const result = await action();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`│ ❯ [DONE] [${toolName}] "${truncatedArg}" [${duration}s ✅]`);
    console.log(`└── [COMPLETED: ▓▓▓▓▓▓▓▓▓▓ 100%] ──────────\n`);
    return result;
  } catch (error: any) {
    console.log(`│ ❯ [ERROR] [${toolName}] به مشکل خورد ❌ (${error?.message || error})`);
    console.log(`└── [FAILED] ───────────────────────────\n`);
    throw error;
  }
}
