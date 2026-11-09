import { processTextStrict } from "./filterService";
import { applyShortcutsStrict } from "./shortcutService";

type PrivateMessageTextContext = {
  username: string;
  topic: string;
  ip: string;
  recipientId: string;
  recipientName: string;
};

type ProcessingDependencies = {
  expandShortcuts: typeof applyShortcutsStrict;
  processText: (
    params: Parameters<typeof processTextStrict>[0],
  ) => Promise<{ filteredText: string }>;
};

export async function processPrivateMessageText(
  text: string,
  context: PrivateMessageTextContext,
  dependencies: ProcessingDependencies = {
    expandShortcuts: applyShortcutsStrict,
    processText: processTextStrict,
  },
): Promise<string> {
  if (!text) return text;

  const expandedText = await dependencies.expandShortcuts(text);
  const result = await dependencies.processText({
    text: expandedText,
    source: `محادثة خاصة مع ${context.recipientName}`,
    suppressSideEffects: true,
    user: {
      username: context.username,
      topic: context.topic,
      ip: context.ip,
    },
    target: context.recipientId,
  });

  return result.filteredText;
}
