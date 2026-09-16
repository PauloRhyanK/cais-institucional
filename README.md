# Cais Investimentos - Site Institucional

Réplica 1:1 idêntica do site institucional [Cais Investimentos](https://www.caisinvestimentos.com.br/).

## 📁 Estrutura do Projeto

```
.
├── index.html                   # Estrutura HTML5 semântica completa
├── script.js                    # Comportamento interativo (menus, dropdown, formulário)
├── package.json                 # Scripts de desenvolvimento e execução
├── styles/
│   └── style.css                # Estilos CSS3, variáveis, gradientes e media queries
├── fonts/
│   └── galanogrotesque/         # Fontes oficiais Galano Grotesque (thin, regular, medium, bold)
└── assets/
    ├── site.webmanifest         # Manifesto PWA
    ├── textures/
    │   └── grainTexture.png     # Textura de granulação
    ├── icons/                   # Logotipos oficiais (SVG), favicons e ícones de interface
    │   ├── newCais.svg
    │   ├── necton.svg
    │   ├── instagram.svg
    │   ├── list.svg
    │   ├── x.svg
    │   └── ...
    └── images/                  # Fotos em alta resolução e banners
        ├── BannerAssessoria.webp
        ├── personalAdvise.jpg
        ├── enterpriseAdvise.jpg
        ├── office.jpg
        ├── Partners.png
        ├── Wallan.png
        ├── Eduardo.png
        └── Wellington.png
```

## 🚀 Como Executar Localmente

### Opção 1: Usando Node.js (Recomendado)
```bash
npm run dev
# ou
npx serve -l 3000 .
```
Abra no navegador em [http://localhost:3000](http://localhost:3000).

### Opção 2: Usando Python 3
```bash
npm run preview
# ou
python3 -m http.server 3000
```
Abra no navegador em [http://localhost:3000](http://localhost:3000).

### Opção 3: Abrir Diretamente
Você também pode abrir o arquivo `index.html` diretamente em qualquer navegador moderno.

## ✉️ Formulário de Contato
O formulário de contato está configurado com o serviço [Web3Forms](https://web3forms.com). Se você desejar receber os contatos em seu próprio e-mail, basta substituir o valor do campo `access_key` no arquivo `index.html` (linha 360) pela sua chave gerada gratuitamente no Web3Forms.
