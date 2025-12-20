# Node.jsのバージョン、変える事。
FROM node:18

# 作業ディレクトリを /app に
WORKDIR /app

# Download Japanese Font
RUN mkdir -p resources/fonts \
    && wget -q -O resources/fonts/NotoSansJP-Bold.otf https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf \
    && wget -q -O resources/fonts/DelaGothicOne-Regular.ttf https://github.com/google/fonts/raw/main/ofl/delagothicone/DelaGothicOne-Regular.ttf \
    && wget -q -O resources/fonts/ZenAntique-Regular.ttf https://github.com/google/fonts/raw/main/ofl/zenantique/ZenAntique-Regular.ttf

# 依存関係のインストール（キャッシュ最適化）
COPY package*.json ./
RUN npm ci || npm install

# アプリコードをコピー（リポジトリ直下の構成を想定）
COPY . .

# ポートを開ける（Koyeb用）、使用してるポート番号にすること。
EXPOSE 3000

# アプリの起動、コマンドを指定しよう。index.jsなら"node", "index.js"
CMD ["node", "index.js"]