# photo-to-ar

Turn a single photo into a 3D model you can place in your room with iPhone AR — fully local, no cloud.

**写真1枚を3Dモデルにして、iPhoneのARで部屋に置く**までを全部ローカルで通すツールセットです。
クラウドAPIは使いません(生成も変換も自分のGPUとPCで完結)。

```
写真1枚 ──▶ TRELLIS(ローカル生成) ──▶ .glb ──▶ .usdz ──▶ ブラウザ3D表示
              RTX 4060/5060クラスでOK      │        │         └ iPhone: AR Quick Lookで実寸配置
                                           │        └ three.js USDZExporter + Pixar usd-core
                                           └ テクスチャ付きメッシュ
```

## 同梱物

| パス | 役割 |
|---|---|
| `index.html` | ビューアページ(model-viewer・モデル選択リスト・AR対応) |
| `serve.ps1` / `serve.py` | LAN配信サーバ(0.0.0.0:8420。usdz/glbへ正しいMIME付与+`/api/models`一覧API) |
| `assets/` | モデル置き場。**glbを置くだけでリストに自動表示**(サンプル同梱) |
| `tools/photo-to-model.mjs` | **写真→glb→usdzの一気通貫コマンド**(要TRELLISサーバ) |
| `tools/glb-to-usdz.mjs` | glb→usdz変換のみ(手持ちのglbにも使える) |
| `tools/make-test-model.mjs` | エンジン無しで疎通確認できるテストモデル生成 |
| `tools/verify.mjs` | サーバ起動→配信→実ブラウザ描画までの自動検証 |
| `docs/trellis-setup.md` | TRELLIS(生成エンジン)のセットアップ手順 |

## 必要なもの

- Windows + NVIDIA GPU(VRAM 8GB以上推奨。RTX 50系対応の手順を`docs/`に記載)
- Node.js 18+(`tools/`のスクリプト用)
- Python 3.x(配信サーバ用)
- [uv](https://docs.astral.sh/uv/)(usdz変換の後段で`usd-core`を呼ぶために使用)

## クイックスタート

```powershell
# 0) 生成エンジンを立てる(初回のみセットアップ: docs/trellis-setup.md)
#    -> http://127.0.0.1:7960 でAPIが待ち受けている状態にする

# 1) 依存を入れる(初回のみ)
cd tools
npm install

# 2) 写真1枚から生成(glbとusdzがassets/へ入る)
node photo-to-model.mjs C:\path\to\photo.jpg mymodel

# 3) 配信してiPhoneで開く
cd ..
powershell -ExecutionPolicy Bypass -File .\serve.ps1
#    -> 表示されたURL(例 http://192.168.x.x:8420)をiPhoneのSafariで開く
#    -> ARボタンで部屋に置ける
```

### エンジン無しでまず試す

TRELLISを入れる前でも、同梱サンプル(トーラスノット)でビューアとAR表示は試せます。
`serve.ps1`を起動してiPhoneで開くだけ。テストモデルを作り直すなら:

```powershell
cd tools
npm run make-test-model
```

## 各段のしくみ

### 生成(写真→glb)

[TRELLIS](https://github.com/microsoft/TRELLIS)(Microsoft・重みMIT)を
[trellis-stable-projectorz](https://github.com/IgorAherne/trellis-stable-projectorz)版で動かします。
RTX 50系(sm_120)向けのビルド済みwheelが同梱されていて、CUDA拡張のコンパイル地獄を回避できるのが採用理由。
被写体の切り抜き(背景除去)はエンジン側が自動でやるので、写真はそのまま投げてOKです。
詳細は[docs/trellis-setup.md](docs/trellis-setup.md)。

### 変換(glb→usdz)

iPhoneのAR Quick Lookは`.usdz`しか受け付けないため、2段で変換します:

1. **three.js USDZExporter**(ヘッドレスChromium上で実行)… ただしこれが書くusdzは
   ASCIIの`.usda`層入りで、AR Quick Lookとの相性が不安定
2. **Pixar usd-core**(`UsdUtils.CreateNewARKitUsdzPackage`)で、単一バイナリ`.usdc`層の
   **ARKit準拠usdz**へ再パッケージ+準拠チェック(`usdchecker --arkit`相当)まで自動実行

制約: Draco/KTX2圧縮glbは未対応。アニメーションはusdzへ引き継がれません(基本PBRは引き継がれる)。

### 表示(ブラウザ/AR)

[`@google/model-viewer`](https://modelviewer.dev/)のバージョン固定CDNで表示。
`assets/`のglbは`/api/models`が自動列挙するので、**ファイルを置くだけでリストに載ります**。
`#m=<name>`でモデル直リンク。iPhoneは`ios-src`のusdzでQuick Lookが起動します。

## 実測の目安(RTX 5060 Ti 16GB / fp16 / steps=12 / texture=1024)

- 生成: 1体あたり**30〜90秒**(複雑な被写体で数分になることも)
- VRAMピーク: **8GB前後**
- 出力glb: 1〜6MB(1〜18万ポリゴン程度)

### 被写体の得意・苦手(試した所感)

- **得意**: 輪郭のはっきりした単体被写体(動物・家具・食器・箱もの)
- **苦手**: 透明/半透明(ガラス・クラゲ)、鏡面反射(テクスチャに焼き込まれる)、
  平板(看板)、細い枝もの。写真1枚なので**見えていない面はAIの推測**になります

## License

MIT (this repository). TRELLIS本体・trellis-stable-projectorz・モデル重みはそれぞれの
ライセンス(TRELLIS公式コード/重み=MIT)に従ってください。
