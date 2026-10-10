# Modelo de dados proposto

## `categories/{categoryId}`
- `name`: mapa `pt`, `en`, `fr`, `es`
- `sortOrder`: número
- `isActive`: booleano
- `createdAt`, `updatedAt`: timestamps

## `products/{productId}`
- `categoryId`: referência lógica à categoria
- `name`, `description`: mapas de tradução
- `price`: inteiro em MZN (meticais; evitar floats)
- `imagePath`: caminho no Storage
- `isAvailable`: booleano
- `modifierGroupIds`: lista de grupos de opções
- `allergens`: lista aprovada pelo restaurante
- `sortOrder`: número
- `createdAt`, `updatedAt`: timestamps

## `modifierGroups/{groupId}`
- `name`: mapa de tradução
- `selectionType`: `single` ou `multiple`
- `minSelections`, `maxSelections`
- `options`: lista ou subcolecção com `id`, `name`, `priceAdjustment`, `isAvailable`
- `createdAt`, `updatedAt`

## `locations/{locationId}`
- `type`: `table` ou `apartment`
- `label`: nome visível
- `qrTokenHash`: hash do token opaco (não guardar token de QR público como segredo reutilizável sem revisão)
- `isActive`: booleano

## `orders/{orderId}`
- `orderNumber`: identificador visível e único
- `locationId`, `locationLabelSnapshot`, `locationTypeSnapshot`
- `language`
- `items`: lista de snapshots com produto, nome, preço unitário, quantidade, opções e notas
- `subtotal`, `total`, `currency`
- `status`: `pending`, `accepted`, `preparing`, `ready`, `delivered`, `cancelled`
- `whatsappStatus`: `not_sent`, `prepared`, `sent`, `failed`
- `createdAt`, `updatedAt`
- `statusHistory`: histórico de mudanças de estado

## `staff/{uid}`
- `displayName`
- `role`: `admin`, `reception`, `restaurant`
- `active`: booleano

## `settings/general`
- `currency`: `MZN`
- `supportedLanguages`: `pt`, `en`, `fr`, `es`
- `restaurantWhatsapp`: número internacional apenas com dígitos
- `openingHours`, `orderSettings`

## Regras de negócio
1. O cliente nunca define o preço final autoritativo.
2. O backend consulta produtos e opções actuais e recalcula o total.
3. Guardar snapshots dos nomes/preços para manter o histórico exacto.
4. Validar quantidade, disponibilidade, selecções permitidas e localização.
5. Usar chave de idempotência para evitar pedidos duplicados.
6. Não guardar dados de cartão ou dados pessoais desnecessários.
