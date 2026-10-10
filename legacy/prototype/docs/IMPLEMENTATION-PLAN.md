# Plano de implementação

## Sprint 1 — Descoberta e configuração
- Confirmar domínio/subdomínio, VPS/Plesk, SSL e backups.
- Recolher menu oficial e fotografias autorizadas.
- Confirmar número WhatsApp e processo operacional de recepção/restaurante.
- Criar Firebase dev e produção separados, se o projecto avançar para produção.

## Sprint 2 — Menu público
- Finalizar design mobile-first.
- Implementar categorias, pesquisa, cartões e detalhes.
- Rever traduções em PT/EN/FR/ES.
- Adicionar acessibilidade, estados vazios e imagens alternativas.

## Sprint 3 — Carrinho e personalizações
- Definir regras de cada grupo de opções.
- Validar limites de quantidade e selecções.
- Guardar carrinho durante a navegação.
- Testar cálculo visual de totais (não autoritativo).

## Sprint 4 — Backend e segurança
- Implementar Cloud Function/API para criar pedidos.
- Recalcular preços no servidor.
- Adicionar idempotência, validação, logs e limites anti-abuso.
- Configurar autenticação e permissões de staff.

## Sprint 5 — Painel
- Lista de pedidos em tempo real.
- Alteração de estado com histórico.
- CRUD de categorias, produtos, traduções e disponibilidade.
- Gestão de localizações e QR Codes.

## Sprint 6 — WhatsApp e piloto
- Começar por mensagem pré-preenchida a partir do painel.
- Se necessário, avaliar WhatsApp Business Platform.
- Gerar QR Codes e testar mesas/apartamentos.
- Formar a equipa e fazer piloto controlado.

## Critérios mínimos de aceitação
- A interface funciona em telemóveis pequenos e em rede lenta.
- O cliente consegue mudar de idioma sem perder o carrinho.
- Produtos indisponíveis não podem ser enviados.
- Preços são recalculados no backend.
- Pedido gravado continua visível mesmo que WhatsApp falhe.
- Só pessoal autorizado acede ao painel.
- Backups e recuperação foram testados.
