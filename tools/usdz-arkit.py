"""Post-process a three.js-exported .usdz (ASCII .usda layers inside) into an
ARKit-compliant .usdz containing a single flattened binary .usdc layer, using
Pixar usd-core (UsdUtils.CreateNewARKitUsdzPackage). Also runs the ARKit
compliance checker (equivalent of `usdchecker --arkit`).

Usage:
    uv run --no-project --with usd-core python usdz-arkit.py <in.usdz> <out.usdz>
"""
import os
import sys
import tempfile
import zipfile

from pxr import Sdf, UsdUtils


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    src = os.path.abspath(sys.argv[1])
    dst = os.path.abspath(sys.argv[2])

    with tempfile.TemporaryDirectory() as td:
        # three.jsのusdz(usda同梱)を展開し、ルート層からARKit準拠のusdzを再パッケージする。
        # AR Quick Lookの互換性を最大化するため、単一のバイナリusdc層へflattenされる。
        with zipfile.ZipFile(src) as z:
            z.extractall(td)
        root = os.path.join(td, 'model.usda')
        if not os.path.exists(root):
            candidates = [n for n in os.listdir(td) if n.endswith(('.usda', '.usd', '.usdc'))]
            if not candidates:
                print('error: no root usd layer found in package', file=sys.stderr)
                return 1
            root = os.path.join(td, candidates[0])
        ok = UsdUtils.CreateNewARKitUsdzPackage(Sdf.AssetPath(root), dst)
        if not ok:
            print('error: CreateNewARKitUsdzPackage failed', file=sys.stderr)
            return 1

    checker = UsdUtils.ComplianceChecker(arkit=True)
    checker.CheckCompliance(dst)
    errors = list(checker.GetErrors()) + list(checker.GetFailedChecks())
    for m in checker.GetWarnings():
        print(f'[usdchecker:warn] {m}', file=sys.stderr)
    for m in errors:
        print(f'[usdchecker:FAIL] {m}', file=sys.stderr)
    print(f'[arkit-usdz] {dst} ({os.path.getsize(dst):,} bytes)')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
