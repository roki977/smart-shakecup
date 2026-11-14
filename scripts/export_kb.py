"""从 调酒知识库/知识库.json 导出网页需要的那一小部分，写到 data/kb-index.json。

网页创建评分会话时要带上知识库里的配方版本（recipe_version）和“摇和”那一步的 step_id，
评分服务才能把复盘建议和配方步骤对上。知识库更新后重新运行：

    python3 scripts/export_kb.py
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
kb = json.loads((root / '调酒知识库' / '知识库.json').read_text(encoding='utf-8'))
out = {}
for r in kb['recipes']:
    shake = next((s['step_id'] for s in r['steps'] if s['action'] == 'shake'), None)
    out[r['id']] = {'name': r.get('name'), 'recipe_version': r['recipe_version'], 'shake_step': shake,
                    'steps': [s['instruction'] for s in r['steps']]}
dest = root / 'data' / 'kb-index.json'
dest.write_text(json.dumps({'built_from': kb.get('built_from_checked_date'), 'recipes': out}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'{len(out)} 个配方 → {dest.relative_to(root)}')
