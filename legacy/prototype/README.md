# Nelson's Place — Menu Digital

Estrutura inicial para o menu digital responsivo do Nelson's Place Apart Hotel.

## Tecnologias
- HTML5, CSS3 e JavaScript (ES modules)
- Bootstrap 5 via CDN
- Firebase Authentication, Cloud Firestore e Cloud Storage (opcionais, configurados depois)
- Integração inicial com WhatsApp por mensagem pré-preenchida

## Estado desta base
Esta é uma base de desenvolvimento, não uma aplicação pronta para produção. O menu de demonstração usa dados locais em `assets/js/menu-data.js`. Os pedidos são simulados no navegador e não são gravados num servidor até configurar uma camada backend segura.

## Executar localmente
Como o projecto usa JavaScript modules, abra a pasta com um servidor local. Por exemplo, com Python instalado:

```bash
python -m http.server 8000
```

Depois visite `http://localhost:8000`.

## Estrutura
- `index.html`: menu público
- `admin/index.html`: esboço inicial do painel administrativo
- `assets/css/styles.css`: estilos
- `assets/js/`: menu, carrinho, idiomas e pedidos de demonstração
- `config/`: exemplos de configuração
- `firebase/`: regras iniciais e exemplo de índices
- `docs/`: modelo de dados e plano de implementação

## Próximos passos obrigatórios antes de produção
1. Substituir os pratos e preços de demonstração pelos dados aprovados pelo restaurante.
2. Adicionar traduções verificadas em PT, EN, FR e ES.
3. Criar um projecto Firebase e configurar `config/firebase-config.example.js`.
4. Implementar uma Cloud Function ou API segura para validar preços, disponibilidade, opções e gravar pedidos.
5. Configurar autenticação e permissões para o painel administrativo.
6. Rever e publicar regras Firestore e Storage adequadas ao modelo de dados.
7. Definir o número WhatsApp oficial do restaurante em `assets/js/config.js`.
8. Testar backups, permissões, falhas de rede e QR Codes em dispositivos reais.

**Segurança:** nunca coloque chaves privadas, tokens de acesso ou credenciais de serviço no frontend. Não permita que o navegador determine o preço final de um pedido.
