export function getSequentialKey(ctx: any): string | undefined {
  if (ctx.callbackQuery) return undefined;
  const text = ctx.message?.text || ctx.msg?.text;
  if (text && /^\/stop(?:@\w+)?(?:\s|$)/i.test(text.trim())) {
    return undefined;
  }
  return ctx.chat?.id ? String(ctx.chat.id) : undefined;
}
