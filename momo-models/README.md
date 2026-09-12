# MOMO の学習済みモデル

[MOMO](https://github.com/ji6czd/momo)（KIRIAKE Masanori、BSD-3-Clause）は日本語の墨字を
点字のかなと分かち書きにする機械学習の自動点訳で、学習済みモデルは配布されていません。
方式の経緯は作者自身の解説にあります（[Qiita](https://qiita.com/ji6czd/items/e5a87318a5ff4a913069)、
2026年3月投稿・5月更新）。形態素解析と分かち書きの規則をやめて文字ごとに読みと境界を推論する
2つのモデルにしたこと、速さのために CRF から遷移特徴量を外し、さらにロジスティック回帰に替えたこと、
学習データをほぼ毎日更新していることが書かれています。
公開されている学習データ（dataset/basic_raw.tsv、8,458 行）から手元で学習したものをここに置きます。
VIPDOT の自動点訳との比較（vipdot/docs/comparison.md）に使いました。

| ファイル | 窓 | 名前 | 大きさ | 学習の設定 |
| --- | --- | --- | --- | --- |
| basic_data_4.mbm | 4 | small | 11.9MB | boundary-n-estimators 100、num-leaves 23（作者の Taskfile と同じ） |
| basic_data_5.mbm | 5 | medium | 24.9MB | boundary-n-estimators 200 |
| basic_data_7.mbm | 7 | large | 38.0MB | boundary-n-estimators 200（作者の既定の窓） |

- MOMO のコミット dab9eb4（2026-09-05 取得）の momo-py で学習した。読みモデルは LinearSVC
  （One-vs-Rest、1,591 クラス）、境界モデルは LightGBM。人名辞書 person_name_dic.tsv（237 語）を使った。
- 学習の手順は作者の momo-py/Taskfile.yml の train と同じ。
  `uv run trainer train --tsv dataset/basic_data.tsv --name-dict dataset/person_name_dic.tsv --window 7 --jobs 4 --boundary-n-estimators 200`
- 使い方: momors を cargo build して、`MOMO_DATASET_DIR=<このフォルダ> momo --model large < 墨字.txt`。
  --model は small / medium / large で、窓 4 / 5 / 7 のファイルを読む。
- 同じ用例と本文で測った値（VIPDOT の測り方。読みも分かち書きも合った割合）

| | 規則書の用例 2,100 組 | 教科書の本文 4,691 文 | 厚生労働省の資料 6,864 文 |
| --- | ---: | ---: | ---: |
| small（窓4） | 39.2% | 80.2% | 72.3% |
| medium（窓5） | 44.3% | 81.2% | 74.5% |
| large（窓7） | 45.1% | 81.0% | 74.1% |

モデルは学習データ（BSD-3-Clause）から作った派生物で、同じライセンスで扱う。
