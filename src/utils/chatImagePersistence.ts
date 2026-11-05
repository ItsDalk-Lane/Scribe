const RECEIPT = /<!-- scribe-image:([a-f0-9]{64}) -->\r?\n([\s\S]*?)\r?\n<!-- \/scribe-image -->/g;

export function stripChatImageReceipts(text: string): string {
  return text.replace(RECEIPT, "$2");
}
