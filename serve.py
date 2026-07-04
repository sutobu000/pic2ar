"""Static file server for the web-ar folder (0.0.0.0:8420).

Serves .usdz/.glb with correct MIME types so iOS Safari reliably hands
.usdz off to AR Quick Look. Run via serve.ps1 (prints the LAN URL first).
"""
import http.server
import json
import os
from pathlib import Path

PORT = 8420

# 配信ルートをこのファイルのあるweb-ar直下に固定する(どこから起動しても同じ挙動にするため)
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    # iOSのAR Quick LookはMIMEタイプに敏感なため明示しておく
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
        '.usdz': 'model/vnd.usdz+zip',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
    }

    def end_headers(self):
        # モデル差し替えが即反映されるようキャッシュを無効化する
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        # assets直下のglb(+同名usdz)を一覧で返す。ファイルを置くだけでビューアのリストに載る
        if self.path.split('?')[0] == '/api/models':
            items = []
            assets = Path('assets')
            for glb in sorted(assets.glob('*.glb')):
                stem = glb.stem
                if stem == 'model':
                    continue  # model.*は直リンク用の既定エイリアスなので一覧からは除外
                usdz = assets / f'{stem}.usdz'
                st = glb.stat()
                items.append({
                    'id': stem,
                    'glb': f'./assets/{glb.name}',
                    'usdz': f'./assets/{usdz.name}' if usdz.exists() else None,
                    'size': st.st_size,
                    'mtime': int(st.st_mtime),
                })
            body = json.dumps(items, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'serving web-ar on 0.0.0.0:{PORT} (Ctrl+C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
