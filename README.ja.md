<div align="center">

# Backleaf 叶间

**ハイライトを、PDF の中だけで終わらせない。**

原文を選び、AI と問いを深め、自分の理解を原文リンク付きの Markdown 読書ノートとして残せます。すべて Obsidian の中で完結します。

[English](README.md) · [简体中文](README.zh-CN.md) · **日本語** · [한국어](README.ko.md)

[![Latest release](https://img.shields.io/github/v/release/zefei124/backleaf?style=flat-square&color=D4537E)](https://github.com/zefei124/backleaf/releases/latest)
![Obsidian 1.11.4+](https://img.shields.io/badge/Obsidian-1.11.4%2B-7C3AED?style=flat-square)
[![MIT License](https://img.shields.io/badge/license-MIT-2F855A?style=flat-square)](LICENSE)

[**Obsidian にインストール**](obsidian://show-plugin?id=backleaf) · [使い方](#一節から思考の流れへ) · [プライバシー](docs/privacy.md) · [更新履歴](CHANGELOG.md)

</div>

---

ハイライトは増えても、そこから生まれた考えは忘れがちです。Backleaf は、原文、問い、対話、そして残したい理解を一つの読書の流れとしてつなぎます。

<img src="docs/assets/backleaf-reading-workflow.png" alt="Obsidian の PDF と並んで表示される Backleaf の対話と理解" width="100%">

## 一節から思考の流れへ

1. **立ち止まった一節を選ぶ。** Obsidian の PDF で原文をハイライトします。
2. **原文から問いを深める。** 選択範囲、書名、章、ページ、原文リンクが対話に引き継がれます。
3. **残す価値のある理解を決める。** 納得できるまで問い、自分の言葉で理解を書き直します。
4. **あとから思考に戻る。** 対話は通常の Markdown として保存され、履歴や思考ツリーから読み返せます。

<!-- 動画の準備ができたら、ここに追加してください：
[![Backleaf の使用デモを見る](docs/assets/backleaf-demo-cover.png)](VIDEO_URL)
-->

## PDF の横にあるだけの AI チャットではありません

- **文脈が離れません。** 原文、ページ、章、書名、出典へ戻るリンクを対話と一緒に保ちます。
- **対話が長く使えるノートになります。** 引用、問い、会話、自分の理解を通常の Markdown に保存します。
- **最後に書くのはあなたです。** AI の下書きを編集することも、最初から自分で書くこともできます。
- **Vault が常に正本です。** プラグイン外で変更されたノートを、Backleaf が黙って上書きすることはありません。

## 読書から生まれた道筋を見る

思考ツリーは、書籍と章から原文、問い、回答へと続く流れを可視化します。

<img src="docs/assets/backleaf-thought-tree.png" alt="原文から生まれた問いと回答を表示する Backleaf の思考ツリー" width="100%">

## 必要なもの

- Obsidian 1.11.4 以降。
- DeepSeek API キー。ご自身のアカウントと API 利用枠を使用します。
- 選択範囲から対話を始める際は、Obsidian で PDF を開いてください。

## インストール

### コミュニティプラグイン

1. **設定 → コミュニティプラグイン** を開きます。
2. **閲覧** で **Backleaf** を検索します。
3. **インストール** を選び、プラグインを有効にします。
3. **インストール** し、プラグインを有効にします。

### 手動インストール

1. 最新の GitHub リリースから `main.js`、`manifest.json`、`styles.css` をダウンロードします。
2. `<保管庫>/.obsidian/plugins/backleaf/` を作成します。
3. 3 つのファイルをそのフォルダーにコピーします。
4. Obsidian を再読み込みし、**設定 → コミュニティプラグイン** で **Backleaf** を有効にします。

## 設定

1. **設定 → コミュニティプラグイン → Backleaf** を開きます。
2. DeepSeek API キーを追加します。キーは Obsidian SecretStorage に保存され、Backleaf の `data.json` には書き込まれません。
3. 必要に応じてモデル、API の Base URL、リクエストのタイムアウトを変更します。

既定のエンドポイントは `https://api.deepseek.com` です。詳細設定では、他の互換 HTTPS エンドポイントやローカル HTTP エンドポイントも使用できます。

## 使い方

1. PDF を開き、文章を選択します。
2. コマンドパレットまたは PDF のコンテキスト操作から Backleaf を起動します。
3. Backleaf チャットで質問します。
4. 残したい対話を保存します。Backleaf は原文の引用、会話、取得できた原文リンクを保持します。
5. 読書ノートを Backleaf の思考ツリービューで開き、構造を振り返ります。

保存したノートは通常の Markdown ファイルなので、Backleaf の外でも編集できます。保存した対話が外部で変更されている場合、競合を確認するまで Backleaf は上書きを拒否します。

## プライバシーとネットワーク通信

Backleaf は、メッセージを送信したときにのみ、設定された AI エンドポイントへリクエストを送ります。送信する内容は、現在選択している原文、書名、章（取得できる場合）、現在の Backleaf の会話です。PDF 全体、無関係な保管庫のノート、保存済みの読書ノート、ローカルファイルパス、その他のローカルデータを意図的に送信することはありません。

API キーは Obsidian SecretStorage から読み取り、設定されたエンドポイントへの認証にのみ使用します。API の利用料金とデータの取り扱いには、選択したプロバイダーとエンドポイントの規約が適用されます。詳細は[プライバシーに関する文書（英語）](docs/privacy.md)をご覧ください。

Backleaf にはクライアント側のテレメトリー、広告、自動更新機構は含まれていません。

## 連絡先

ご質問、ご提案、フィードバックはこちらへお寄せください：[hnyu588@gmail.com](mailto:hnyu588@gmail.com)

**WeChat QR コード**

<img src="docs/assets/contact-wechat.png" alt="WeChat QR コード（アップロード待ち）" width="220">

WeChat の友達申請には **Backleaf** と記載してください。`docs/assets/contact-wechat.png` をアップロードすると、ここに表示されます。

## ソースからビルド

```bash
npm install
npm run build
npm test
```

リリース用のファイル `main.js`、`manifest.json`、`styles.css` はリポジトリのルートに出力されます。

## ライセンス

Backleaf は [MIT License](LICENSE) で公開されています。サードパーティーのソフトウェアやサービスには、それぞれのライセンスと利用規約が適用されます。
