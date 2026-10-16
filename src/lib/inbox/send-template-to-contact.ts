import type { MessageTemplate } from "@/types";
import type { TemplateSendValues } from "@/components/inbox/template-picker";

/**
 * Business-initiated template send to a contact (Contact detail →
 * Send template, Inbox → New message). No conversation_id: the send route
 * finds or creates the contact's thread on `values.whatsappConfigId` (the
 * account default when unset), so the message lands in that number's inbox.
 *
 * Resolves to the thread id, or throws with the server's reason.
 */
export async function sendTemplateToContact(
  contactId: string,
  template: MessageTemplate,
  values: TemplateSendValues,
): Promise<{ conversationId: string | null }> {
  const res = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contact_id: contactId,
      whatsapp_config_id: values.whatsappConfigId ?? null,
      message_type: "template",
      template_name: template.name,
      template_language: template.language,
      template_message_params: {
        body: values.body,
        headerText: values.headerText,
        headerMediaUrl: values.headerMediaUrl,
        buttonParams: values.buttonParams,
      },
      template_params: values.body,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
  return { conversationId: payload?.conversation_id ?? null };
}
