/**
 * Staff permissions. Each staff member has one role (perfil); a role is a set
 * of permissions, editable by whoever has "staff.manage". The built-in
 * Administrador role holds "*" (every permission, including future ones) and
 * cannot be reduced, so the hotel can never lock itself out.
 */

export const PERMISSIONS = [
  "orders.view",
  "orders.status",
  "orders.cancel",
  "orders.deposit",
  "chat.reply",
  "orders.pause",
  "menu.availability",
  "menu.edit",
  "menu.prices",
  "reports.view",
  "reports.export",
  "staff.manage",
  "settings.manage",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Stored on a role to mean "all permissions". */
export const ALL_PERMISSIONS = "*";

export function resolvePermissions(stored: readonly string[]): Permission[] {
  if (stored.includes(ALL_PERMISSIONS)) return [...PERMISSIONS];
  return PERMISSIONS.filter((p) => stored.includes(p));
}

export function hasAny(granted: readonly Permission[], ...required: Permission[]): boolean {
  return required.some((p) => granted.includes(p));
}

/** Labels and grouping for the dashboard's permission grid (Portuguese). */
export const PERMISSION_GROUPS: { title: string; items: { key: Permission; label: string }[] }[] = [
  {
    title: "Pedidos",
    items: [
      { key: "orders.view", label: "Ver pedidos e imprimir talões" },
      { key: "orders.status", label: "Avançar o estado (confirmar, preparar, pronto, concluir)" },
      { key: "orders.cancel", label: "Cancelar pedidos" },
      { key: "orders.deposit", label: "Confirmar sinais (pagamentos)" },
      { key: "chat.reply", label: "Responder aos clientes no chat" },
      { key: "orders.pause", label: "Pausar / retomar pedidos" },
    ],
  },
  {
    title: "Menu",
    items: [
      { key: "menu.availability", label: "Marcar artigos esgotados / disponíveis" },
      { key: "menu.edit", label: "Editar menu (artigos, categorias, opções, fotos)" },
      { key: "menu.prices", label: "Alterar preços" },
    ],
  },
  {
    title: "Relatórios",
    items: [
      { key: "reports.view", label: "Ver relatórios e vendas, imprimir fecho" },
      { key: "reports.export", label: "Exportar dados e resumo ao gerente" },
    ],
  },
  {
    title: "Administração",
    items: [
      { key: "staff.manage", label: "Gerir equipa e perfis de acesso" },
      { key: "settings.manage", label: "Alterar definições do hotel" },
      { key: "audit.view", label: "Ver registo de alterações" },
    ],
  },
];
