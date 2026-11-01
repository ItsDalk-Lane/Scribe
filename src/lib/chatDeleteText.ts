import { t } from "@/lib/i18n";

interface DeleteTextDescriptor {
  displayName: string;
  agentProductName?: string;
}

function agentName(descriptor: DeleteTextDescriptor): string {
  return descriptor.agentProductName ?? descriptor.displayName;
}

export function describeChatDelete(descriptor: DeleteTextDescriptor | undefined): string {
  return descriptor
    ? t(
        "Delete this chat from Scribe? {agent} may keep its own copy of this conversation on this computer.",
        { agent: agentName(descriptor) }
      )
    : t("Delete this chat from Scribe?");
}

export function formatChatDeleteNotice(descriptor: DeleteTextDescriptor | undefined): string {
  return descriptor
    ? t("Chat deleted from Scribe. {agent} may keep its own copy.", {
        agent: agentName(descriptor),
      })
    : t("Chat deleted from Scribe.");
}
