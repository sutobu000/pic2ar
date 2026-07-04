# TRELLIS セットアップ(trellis-stable-projectorz v40)

写真1枚→テクスチャ付きメッシュ(`.glb`)を出す生成エンジンの導入手順。
Windows + NVIDIA GPU向け。**RTX 50系(Blackwell / sm_120)でもコンパイル不要で動く**のが
このディストリビューションを選ぶ理由です。

> 検証環境: Windows 11 / RTX 5060 Ti 16GB / ドライバ576+。
> 同梱物: Python 3.11(ポータブル) / PyTorch 2.7.0+cu128 / RTX 50系向けprebuilt wheel群。

## 1. 導入

1. [IgorAherne/trellis-stable-projectorz](https://github.com/IgorAherne/trellis-stable-projectorz)の
   Releasesから`NEW_v40_py311_trellis_stableprojectorz.zip`(約330MB)をダウンロード
2. 好きな場所へ展開(パスに日本語・スペースが無い場所を推奨)
3. `run-fp16.bat`を実行 → 初回はvenv構築と依存インストールが走る
4. **モデル重みは初回サーバ起動時**にHugging Faceから自動ダウンロードされる(数GB)

## 2. 商用クリーン化(任意・おすすめ)

v40の既定は重みをHFミラー`jetx/TRELLIS-image-large`から読む実装ですが、
公式**`microsoft/TRELLIS-image-large`(MIT)**へ差し替えられます。手順:

1. `code\`配下の5ファイルで`"jetx/TRELLIS-image-large"`→`"microsoft/TRELLIS-image-large"`に置換:
   `api_spz/core/state_manage.py` / `gradio_main.py` / `app.py` / `example.py` / `example_multi_image.py`
2. 初回起動でDLされた重みのsha256を、HF公式リポジトリの値と突合して確認

私が検証した時点(2026-07)では、jetxミラーと公式はsafetensors全ファイルが**バイト一致**でした。
それでも「公式から取得した事実」を作れるので、商用利用を視野に入れるなら差し替えを推奨します。

## 3. 起動

| モード | コマンド | ポート |
|---|---|---|
| APIサーバ(本ツールが使う) | `run-fp16.bat` | `127.0.0.1:7960` |
| ブラウザUI(単発で試す用) | `run-gradio-fp16.bat` | `127.0.0.1:7860` |

- fp16(half)で十分動きます(8GB級GPUでも可)。fp32は12〜16GB必要
- 起動完了の確認: `curl http://127.0.0.1:7960/ping` が200を返せばOK

### batが`'... is not recognized'`で全滅するとき

環境変数`NoDefaultCurrentDirectoryInExePath=1`が設定されている環境では、bat内の
`call run.bat`等が全部失敗します(cmdがカレントディレクトリを実行ファイル探索から除外するため)。
回避はどちらか:

- その端末で`set NoDefaultCurrentDirectoryInExePath=`してから実行
- batを介さずvenvのpythonを直接叩く:

```powershell
& '<展開先>\code\venv\Scripts\python.exe' '<展開先>\code\api_spz\main_api.py' --precision half
```

## 4. APIの叩き方

**ファイル添付経路はv40にバグがあるため(`UploadFile`に`len()`を呼んで500)、
`image_base64`フィールドで渡します。** 本リポジトリの`tools/photo-to-model.mjs`は
これを織り込み済みなので、直接叩きたい人向けの参考:

```bash
base64 -w0 input.jpg > img.b64
curl -s -X POST http://127.0.0.1:7960/generate_no_preview \
  -F "image_base64=<img.b64" \
  -F "seed=1" \
  -F "ss_sampling_steps=12" -F "ss_guidance_strength=7.5" \
  -F "slat_sampling_steps=12" -F "slat_guidance_strength=3.0" \
  -F "mesh_simplify_ratio=0.95" -F "texture_size=1024" -F "output_format=glb"
curl -s http://127.0.0.1:7960/download/model -o out.glb
```

主なエンドポイント: `GET /ping` / `GET /status` / `POST /generate_no_preview` / `GET /download/model`。
詳細は同梱の`code\api_spz\api-documentation.html`。

## 5. 実測の目安(RTX 5060 Ti 16GB / fp16)

| 項目 | 値 |
|---|---|
| 生成時間 | 30〜90秒/体(複雑な被写体は数分) |
| VRAMピーク | 8GB前後 |
| 常駐(アイドル) | 4〜5GB(cpu↔cuda動的スワップ設計) |

## 6. 無害な警告(気にしなくていい)

- `hf_xet`未導入のXet警告 → HTTPフォールバックで問題なし
- Tritonのエラー表示 → 上流が「無視してよい」と明記
- `update.bat`は上流が不具合報告ありと注意書きしているので基本使わない
