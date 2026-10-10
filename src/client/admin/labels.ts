import type { IntegrationStatus, OrderStatus, StaffRole } from "../../shared/constants";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  PREPARING: "Em preparação",
  READY: "Pronto",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

/** Label of the button that moves an order to the given status. */
export const STATUS_ACTION: Record<OrderStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmar pedido",
  PREPARING: "Iniciar preparação",
  READY: "Marcar como pronto",
  COMPLETED: "Marcar como entregue",
  CANCELLED: "Cancelar pedido",
};

export const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Administrador",
  reception: "Recepção",
  restaurant: "Restaurante",
};

export const WHATSAPP_STATUS: Record<IntegrationStatus, { label: string; tone: "success" | "warning" | "danger" | "muted"; help: string }> = {
  link_ready: {
    label: "Link disponível",
    tone: "muted",
    help: "Foi mostrado ao hóspede um botão para enviar o pedido por WhatsApp. O hóspede ainda não o abriu.",
  },
  link_opened: {
    label: "Aberto pelo hóspede",
    tone: "warning",
    help: "O hóspede abriu o WhatsApp com a mensagem preenchida. Não é possível confirmar se carregou em «Enviar».",
  },
  pending: { label: "A enviar", tone: "warning", help: "Envio automático em curso." },
  sent: { label: "Enviado", tone: "success", help: "A mensagem foi aceite pela API do WhatsApp Business." },
  failed: { label: "Falhou", tone: "danger", help: "O envio automático falhou. O pedido está registado; pode tentar novamente." },
  not_configured: {
    label: "Não configurado",
    tone: "muted",
    help: "Não existe número de WhatsApp do hotel nas Definições.",
  },
};
