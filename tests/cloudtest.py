import asyncio, json, uuid, datetime, re
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright
DB = {'posts': [], 'comments': [], 'likes': []}
now = lambda: datetime.datetime.now(datetime.UTC).isoformat()
async def handle(route):
    req = route.request; u = urlparse(req.url); table = u.path.split('/')[-1]; q = parse_qs(u.query)
    assert req.headers.get('apikey') == 'test-anon', 'missing apikey'
    if req.method == 'GET' and table == 'posts':
        out = []
        for p in sorted(DB['posts'], key=lambda x: x['created_at'], reverse=True):
            out.append({**p, 'likes': [{'count': sum(1 for l in DB['likes'] if l['post_id'] == p['id'])}],
                        'comments': [c for c in DB['comments'] if c['post_id'] == p['id']]})
        return await route.fulfill(status=200, content_type='application/json', body=json.dumps(out))
    if req.method == 'POST':
        body = json.loads(req.post_data)
        if table == 'likes' and any(l['post_id'] == body['post_id'] and l['client_id'] == body['client_id'] for l in DB['likes']):
            return await route.fulfill(status=409, body='')
        row = {'id': str(uuid.uuid4()), 'created_at': now(), **body}
        DB[table].append(row)
        return await route.fulfill(status=201, content_type='application/json', body=json.dumps([row]))
    if req.method == 'DELETE' and table == 'likes':
        pid = q['post_id'][0][3:]; cid = q['client_id'][0][3:]
        DB['likes'] = [l for l in DB['likes'] if not (l['post_id'] == pid and l['client_id'] == cid)]
        return await route.fulfill(status=204, body='')
    await route.fulfill(status=400, body='unexpected')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        async def page():
            pg = await b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.route('**/community-config.js', lambda r: r.fulfill(status=200, content_type='application/javascript',
                body="window.COMMUNITY_CONFIG = { supabaseUrl: 'https://fake.supabase.co', anonKey: 'test-anon' };"))
            await pg.route('https://fake.supabase.co/**', handle)
            await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(400); return pg
        A = await page()
        await A.evaluate("() => { previousScenario = 0; start(); clearInterval(timer); for (let i=1;i<=56;i++) consumeSample(demoSample(i*.25)); finish(); document.querySelector('#modal').open && document.querySelector('#modal').close(); }")
        await A.click('#share-community'); await A.wait_for_timeout(300)
        await A.fill('#composer input[name=name]', '甲同学'); await A.fill('#composer input[name=title]', '云端测试帖')
        await A.click('#composer button[type=submit]'); await A.wait_for_timeout(1200)
        print('A after post:', await A.evaluate("() => [document.querySelector('.post-detail h2')?.textContent, document.querySelector('#comm-note').textContent]"))
        # 另一个“用户”（新的浏览器上下文 = 不同设备）
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900}); B = await ctx.new_page(); B.on('pageerror', lambda e: errs.append(str(e)))
        await B.route('**/community-config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.COMMUNITY_CONFIG = { supabaseUrl: 'https://fake.supabase.co', anonKey: 'test-anon' };"))
        await B.route('https://fake.supabase.co/**', handle)
        await B.goto('http://localhost:8765/'); await B.wait_for_timeout(400)
        await B.click('#open-community'); await B.wait_for_timeout(800)
        pid = await B.evaluate("() => commPosts.find(p => p.title === '云端测试帖')?.id")
        print('B sees A post:', bool(pid))
        await B.click(f'[data-post="{pid}"]'); await B.wait_for_timeout(400)
        await B.fill('#comment-form input[name=name]', '乙同学'); await B.fill('#comment-form input[name=text]', '收到！'); await B.click('#comment-form button'); await B.wait_for_timeout(800)
        await B.click('#like'); await B.wait_for_timeout(600)
        await B.evaluate("() => document.querySelector('#modal').close()")
        await B.click('#open-community'); await B.wait_for_timeout(800)
        print('B view:', await B.evaluate(f"() => {{ const p = commPosts.find(p => p.id === '{pid}'); return [p.likes, p.comments.map(c => c.author + ':' + c.text)]; }}"))
        print('DB:', len(DB['posts']), 'posts', len(DB['comments']), 'comments', len(DB['likes']), 'likes', '| curve points:', len(DB['posts'][0]['data']['curve']))
        # 取消点赞
        await B.click(f'[data-post="{pid}"]'); await B.wait_for_timeout(300); await B.click('#like'); await B.wait_for_timeout(600)
        print('after unlike DB likes:', len(DB['likes']))
        # 云端挂掉 → 退回本机
        C = await b.new_page(); C.on('pageerror', lambda e: errs.append(str(e)))
        await C.route('**/community-config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.COMMUNITY_CONFIG = { supabaseUrl: 'https://down.supabase.co', anonKey: 'x' };"))
        await C.route('https://down.supabase.co/**', lambda r: r.abort())
        await C.goto('http://localhost:8765/'); await C.wait_for_timeout(300); await C.click('#open-community'); await C.wait_for_timeout(800)
        print('fallback note:', await C.evaluate("() => [document.querySelector('#comm-note').textContent, document.querySelectorAll('#feed .post-card').length]"))
        print('errors', errs); await b.close()
asyncio.run(main())
