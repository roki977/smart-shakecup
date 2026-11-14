"""从 调酒知识库/网站图鉴接口.json 生成网页图鉴用的 catalog.js（117 款）。

知识库里配料是来源原文（英文、各种单位写法），这里做三件事：
1. 把用量统一成 ml（oz×30、cl×10），没法换算的保留原样并译成中文（吧勺、滴、补满……）；
2. 配料名、酒名译成中文（下面的对照表，对不上的保留英文原文）；
3. 按步骤推断做法、杯型、酒色和装饰，用来画插画。推断只影响插画，不影响配方本身。
步骤直接用知识库里的中文说明；装饰保留来源原文（还没有逐条译过）。

知识库更新后重新运行：python3 scripts/build_catalog.py
"""
import json, re, unicodedata
from pathlib import Path

root = Path(__file__).resolve().parent.parent
kb = json.loads((root / '调酒知识库' / '网站图鉴接口.json').read_text(encoding='utf-8'))
sources = {s['id']: s for s in kb['sources']}

NAMES = {
    'Alexander': '亚历山大', 'Americano': '美国佬', 'Angel Face': '天使之颜', 'Aviation': '飞行',
    'Bee’s Knees': '蜂之膝', 'Bellini': '贝里尼', 'Between the Sheets': '床笫之间', 'Black Russian': '黑色俄罗斯',
    'Bloody Mary': '血腥玛丽', 'Boulevardier': '花花公子', 'Bramble': '荆棘', 'Brandy Crusta': '白兰地库斯塔',
    'Caipirinha': '卡琵莉亚', 'Canchanchara': '坎昌查拉', 'Cardinale': '红衣主教', 'Casino': '赌场',
    'Champagne Cocktail': '香槟鸡尾酒', 'Chartreuse Swizzle': '查特酒碎冰', 'Clover Club': '三叶草俱乐部',
    'Corpse Reviver #2': '亡者复苏 2 号', 'Cosmopolitan': '大都会', 'Cuba Libre': '自由古巴', 'Daiquiri': '大吉利',
    'Dark ‘N’ Stormy': '月黑风高', 'Don’s Special Daiquiri': '唐的特调大吉利', 'Dry Martini': '干马天尼',
    'Espresso Martini': '浓缩咖啡马天尼', 'Fernandito': '费尔南迪托', 'French 75': '法式 75',
    'French Connection': '法国贩毒网', 'French Martini': '法式马天尼', 'Garibaldi': '加里波第',
    'Gin Basil Smash': '金酒罗勒碎', 'Gin Fizz': '金菲士', 'Grand Margarita': '至尊玛格丽特', 'Grasshopper': '绿色蚱蜢',
    'Hanky Panky': '汉基帕基', 'Hemingway Special': '海明威特调', 'Horse’s Neck': '马颈', 'IBA Tiki': 'IBA 提基',
    'Illegal': '非法', 'Irish Coffee': '爱尔兰咖啡', 'John Collins': '约翰柯林斯', 'Jungle Bird': '丛林鸟', 'Kir': '基尔',
    'Last Word': '临别一语', 'Lemon Drop Martini': '柠檬糖马天尼', 'Long Island Iced Tea': '长岛冰茶', 'Mai-Tai': '迈泰',
    'Manhattan': '曼哈顿', 'Margarita': '玛格丽特', 'Martinez': '马丁内斯', 'Mary Pickford': '玛丽·璧克馥',
    'Mimosa': '含羞草', 'Mint Julep': '薄荷朱利普', 'Missionary’s Downfall': '传教士的堕落', 'Mojito': '莫吉托',
    'Monkey Gland': '猴腺', 'Moscow Mule': '莫斯科骡子', 'Naked and Famous': '赤裸与名望', 'Negroni': '尼格罗尼',
    'New York Sour': '纽约酸酒', 'Old Cuban': '老古巴人', 'Old Fashioned': '古典', 'Paloma': '帕洛玛',
    'Paper Plane': '纸飞机', 'Paradise': '天堂', 'Penicillin': '盘尼西林', 'Pina Colada': '椰林飘香',
    'Pisco Punch': '皮斯科宾治', 'Pisco Sour': '皮斯科酸酒', 'Planters Punch': '种植者宾治', 'Porn Star Martini': '艳星马天尼',
    'Porto Flip': '波特蛋酒', 'Rabo de Galo': '公鸡尾巴', 'Ramos Fizz': '拉莫斯菲士', 'Remember the Maine': '勿忘缅因号',
    'Russian Spring Punch': '俄式春日宾治', 'Rusty Nail': '锈钉', 'Sazerac': '萨泽拉克', 'Sea Breeze': '海风',
    'Sex on the Beach': '性感沙滩', 'Sherry Cobbler': '雪莉柯布勒', 'Sidecar': '边车', 'Singapore Sling': '新加坡司令',
    'South Side': '南方', 'Spicy Fifty': '辣味五十', 'Spritz': '斯普里兹', 'Stinger': '毒刺', 'Suffering Bastard': '苦命人',
    'Tequila Sunrise': '龙舌兰日出', 'Three Dots and a Dash': '三点一划', 'Tipperary': '蒂珀雷里',
    'Tommy’s Margarita': '汤米玛格丽特', 'Trinidad Sour': '特立尼达酸酒', 'Tuxedo': '燕尾服', 'Ve.N.To': '维恩托',
    'Vesper': '维斯珀', 'Vieux Carré': '老广场', 'Whiskey Sour': '威士忌酸', 'White Lady': '白色佳人', 'Zombie': '僵尸',
    'Almond Thief': '杏仁窃贼', 'Ghost Note': '幽灵音符', 'Devil Runner': '魔鬼跑者', 'As Islay Dying': '艾雷将死',
    'Iron Path': '铁之路', 'Starchaser': '追星者', 'Easy Tiger': '慢着老虎', "Dragon's Dream": '龙之梦',
    'Sky Ladder': '天梯', 'Buster Sword': '破坏剑', 'Clear Sky': '晴空', 'Secret Third Option': '第三个选项',
    "Benton's Old Fashioned": '本顿古典',
}

# 配料名：按顺序匹配（小写），先写具体的再写笼统的
ING = [
    (r'bacon-fat-washed bourbon', '培根油洗波本'), (r'curry-leaf cognac', '咖喱叶干邑'),
    (r'basil eau-de-vie', '罗勒白兰地'), (r'tomato eau-de-vie', '番茄白兰地'), (r'ginger shochu', '姜味烧酎'),
    (r'vanilla vodka|vodka vanilla', '香草伏特加'), (r'vodka citron', '柑橘伏特加'), (r'smirnoff vodka|vodka', '伏特加'),
    (r'old tom gin', '老汤姆金酒'), (r'london dry gin', '伦敦干金酒'), (r'dry gin', '干金酒'), (r'gin', '金酒'),
    (r'bourbon or rye|rye whiskey or bourbon', '波本或黑麦威士忌'), (r'bourbon', '波本威士忌'),
    (r'rye', '黑麦威士忌'), (r'irish whisk', '爱尔兰威士忌'), (r'lagavulin', '乐加维林 16 年'),
    (r'blended scotch|scotch', '苏格兰威士忌'),
    (r'white cuban ron|cuban rum', '古巴朗姆'), (r'jamaica overproof', '牙买加高度白朗姆'),
    (r'jamaican dark rum', '牙买加黑朗姆'), (r'amber jamaican|gold jamaican|jamaican rum', '牙买加朗姆'),
    (r'gold puerto rican', '波多黎各金朗姆'), (r'demerara rum', '德梅拉拉朗姆'), (r'blackstrap', '黑糖蜜朗姆'),
    (r'goslings', '高斯林朗姆'), (r'rhum martinique agricole|martinique molasses', '马提尼克农业朗姆'),
    (r'ron profundo', '哈瓦那俱乐部 Profundo 朗姆'), (r'ron smoky', '哈瓦那俱乐部 Smoky 朗姆'),
    (r'blended aged rum|aged rum', '陈年朗姆'), (r'white rum', '白朗姆'), (r'\brum\b', '朗姆'),
    (r'amburana cachaca', '安布拉纳木卡莎萨'), (r'silver cachaca', '银卡莎萨'), (r'cacha', '卡莎萨'),
    (r'cuban aguardiente', '古巴甘蔗烈酒'), (r'espadin mezcal|mezcal', '梅斯卡尔'),
    (r'blanco tequila', '白龙舌兰'), (r'tequila', '100% 龙舌兰'),
    (r'cognac or brandy', '干邑或白兰地'), (r'cognac', '干邑'), (r'apricot brandy', '杏子白兰地'),
    (r'peach brandy', '桃子白兰地'), (r'cherry brandy', '樱桃白兰地（路萨朵）'), (r'calvados', '卡尔瓦多斯苹果白兰地'),
    (r'brandy', '白兰地'), (r'pisco', '皮斯科'), (r'grappa', '格拉帕'),
    (r'green chartreuse', '绿查特酒'), (r'yellow chartreuse', '黄查特酒'), (r'genepy', '杰纳比'),
    (r'triple sec', '橙味利口酒（Triple Sec）'), (r'cointreau', '君度'), (r'grand marnier', '柑曼怡'),
    (r'orange curacao|curacao', '橙皮利口酒（库拉索）'),
    (r'maraschino', '马拉斯奇诺樱桃利口酒'), (r'crème de violette', '紫罗兰利口酒'),
    (r'cr[eè]me de cassis', '黑加仑利口酒'), (r'crème de mûre', '黑莓利口酒'),
    (r'cr[eè]me de cacao \(brown\)', '深色可可利口酒'), (r'white cr[eè]me de cacao|cr[eè]me de cacao \(white\)', '白可可利口酒'),
    (r'white crème de menthe', '白薄荷利口酒'), (r'crème de menthe', '绿薄荷利口酒'),
    (r'kahl|coffee liqueur', '咖啡利口酒'), (r'amaretto', '杏仁利口酒'), (r'frangelico', '榛子利口酒'),
    (r'drambuie', '杜林标'), (r'b[ée]n[ée]dictine', '本笃会利口酒'), (r'falernum', '法勒南'),
    (r'passion fruit liqueur', '百香果利口酒'), (r'raspberry liqueur', '覆盆子利口酒'), (r'peach schnapps', '桃子烈酒'),
    (r'peach liqueur', '桃子利口酒'), (r'peach aperitif', '桃子开胃酒'), (r'apricot liqueur', '杏子利口酒'),
    (r'biscotti liqueur', '意式脆饼利口酒'), (r'coconut liqueur', '椰子利口酒'), (r'melon liqueur', '蜜瓜利口酒'),
    (r'shiso liqueur', '紫苏利口酒'),
    (r'cherry sangue', '摩拉科樱桃利口酒'), (r'absinthe|pernod', '苦艾酒'),
    (r'bitter campari|campari', '金巴利'), (r'aperol', '阿佩罗'), (r'cappelletti', '卡佩莱蒂开胃酒'),
    (r'amaro nonino', '诺妮诺阿玛罗'), (r'amaro pasubio', '帕苏比奥阿玛罗'), (r'amaro', '阿玛罗'),
    (r'fernet', '菲奈特'), (r'cynar', '西娜尔'),
    (r'sweet vermouth cinzano', '甜味美思（仙山露红）'), (r'sweet red vermouth|sweet vermouth', '甜味美思'),
    (r'dry vermouth', '干味美思'), (r'blanc vermouth', '白味美思'), (r'lillet', '利莱白'), (r'rinquinquin', 'RinQuinQuin 桃子开胃酒'),
    (r'amontillado', '阿蒙提亚多雪莉'), (r'palo cortado', '帕罗科塔多雪莉'), (r'manzanilla', '曼萨尼亚雪莉'),
    (r'fino sherry', '菲诺雪莉'), (r'px sherry', 'PX 雪莉'), (r'tawny port', '茶色波特酒'),
    (r'red wine|malbec', '红葡萄酒'), (r'dry white wine', '干白葡萄酒'),
    (r'champagne to serve', '香槟（另杯配上）'), (r'brut champagne or prosecco', '干型香槟或普罗塞克'),
    (r'champagne', '香槟'), (r'prosecco', '普罗塞克'), (r'sparkling wine', '起泡酒'),
    (r'freshly squeezed lemon|fresh squeezed lemon|fresh lemon|lemon juice', '鲜柠檬汁'),
    (r'freshly squeezed lime|fresh squeezed lime|fresh lime juice|lime juice|^fresh lime$|30 fresh lime', '鲜青柠汁'),
    (r'lime cut', '青柠（切小块）'), (r'yuzu', '柚子汁'),
    (r'orange juice', '鲜橙汁'), (r'pineapple juice', '菠萝汁'), (r'grapefruit juice', '西柚汁'),
    (r'cranberry', '蔓越莓汁'), (r'tomato juice', '番茄汁'), (r'sugar cane juice', '甘蔗汁'),
    (r'passion fruit puree', '百香果果泥'), (r'white peach puree', '白桃果泥'), (r'passion fruit syrup', '百香果糖浆'),
    (r'honey mix \(replace', '洋甘菊蜂蜜糖浆'), (r'honey', '蜂蜜糖浆'), (r'raw honey', '生蜂蜜'),
    (r'demerara sugar syrup|rich syrup', '浓糖浆'), (r'simple syrup|sugar syrup', '糖浆'),
    (r'orgeat', '杏仁糖浆'), (r'grenadine', '红石榴糖浆'), (r'raspberry syrup', '覆盆子糖浆'),
    (r'agave nectar', '龙舌兰糖浆'), (r'cinnamon syrup', '肉桂糖浆'), (r'mango syrup', '芒果糖浆'),
    (r'watermelon syrup', '西瓜糖浆'), (r'yellow pepper syrup', '黄椒糖浆'), (r'maple syrup', '枫糖浆'),
    (r'elderflower', '接骨木花糖浆'), (r'chamomile cordial', '洋甘菊糖浆'), (r'donn', '唐的调和糖浆（Donn’s Mix）'),
    (r'sugar cube', '方糖'), (r'vanilla sugar', '香草糖'), (r'powdered sugar', '糖粉'),
    (r'superfine sugar', '细砂糖'), (r'white cane sugar', '白蔗糖'), (r'^sugar$', '糖'),
    (r'vanilla extract', '香草精'),
    (r'peychaud', '佩肖苦精'), (r'orange bitters', '橙味苦精'), (r'angostura|aromatic bitters', '安格斯图拉苦精'),
    (r'orange flower water', '橙花水'), (r'worcestershire', '伍斯特酱'),
    (r'tabasco', '塔巴斯科辣酱、芹菜盐、胡椒（按口味）'), (r'msg', '味精溶液'), (r'saline', '盐水'),
    (r'egg yolk', '蛋黄'), (r'egg white', '蛋清'), (r'fresh cream|^cream', '鲜奶油'), (r'coconut cream', '椰浆'),
    (r'espresso', '浓缩咖啡'), (r'hot coffee', '热咖啡'),
    (r'ginger beer', '姜汁啤酒'), (r'ginger ale', '姜汁汽水'), (r'pink grapefruit soda', '粉红西柚汽水'),
    (r'cola', '可乐'), (r'soda water', '苏打水'), (r'water', '清水'),
    (r'mint', '薄荷'), (r'basil', '罗勒叶'), (r'gengibre|ginger', '鲜姜片'), (r'cloves', '丁香'),
    (r'pineapple chunks', '菠萝块'), (r'red chili', '红辣椒片'), (r'cayenne', '卡宴辣椒粉'),
    (r'lemon eighths', '柠檬（切八瓣）'), (r'lemon wheel', '柠檬片'), (r'orange wheel', '橙片'),
    (r'allspice', '多香果利口酒'), (r'salt', '盐'),
]

UNIT = {'bar spoon': '吧勺', 'bar spoons': '吧勺', 'tablespoon': '汤匙', 'teaspoon': '茶匙', 'teaspoons': '茶匙',
        'tsp': '茶匙', 'dash': '抖', 'dashes': '抖', 'drop': '滴', 'drops': '滴', 'pc': '片', 'pcs': '个',
        'thin slices': '薄片', 'sprigs': '枝', 'leaves': '片'}


def zh_ing(name):
    n = unicodedata.normalize('NFC', name).lower().replace('’', "'").strip(' *')
    for pat, zh in ING:
        if re.search(pat, n):
            opt = '（可选）' if 'optional' in n else ''
            return zh + opt
    return name.strip(' *')


def num(s):
    s = s.strip()
    if re.fullmatch(r'\d+/\d+', s):
        a, b = s.split('/'); return int(a) / int(b)
    m = re.match(r'(\d+(?:\.\d+)?)', s)
    return float(m.group(1)) if m else None


def parse(text):
    """返回 [中文名, 用量]，用量是数字（ml）或中文字符串"""
    t = re.sub(r'\s+', ' ', unicodedata.normalize('NFC', text).strip())
    low = t.lower()
    for pat, amt in [(r'^(?:a )?splash of (.*)', '少许'), (r'^few dashes (.*)', '几抖'), (r'^(?:a )?dash of (.*)', '1 抖'),
                     (r'^a pinch of (.*)', '一小撮'), (r'^few drops (?:of )?(.*)', '几滴'),
                     (r'^(?:top up|fill up|top)(?: with)? (.*)', '补满')]:
        m = re.match(pat, low)
        if m: return [zh_ing(t[len(t) - len(m.group(1)):]), amt]
    # 末尾带用量：“Aperol 0.75 oz”“Angostura 2 dash”
    m = re.match(r'^(.*?)\s+(\d+(?:\.\d+)?)\s*(oz|ml|tsp|dash|drop)s?\b(.*)$', t, re.I)
    if m and not re.match(r'^\d', t):
        name, q, u, rest = m.groups(); q = float(q); u = u.lower()
        if u == 'oz': return [zh_ing(name + rest), round(q * 30)]
        if u == 'ml': return [zh_ing(name + rest), round(q)]
        return [zh_ing(name + rest), f'{q:g} {UNIT.get(u, u)}']
    # 开头带用量
    m = re.match(r'^(\d+(?:[./]\d+)?(?:\s*(?:-|to)\s*\d+)?)\s*(ml|cl|bar spoons?|tablespoons?|teaspoons?|tsp|dash(?:es)?|drops?|pcs?|thin slices?|sprigs)?\.?\s*(?:of\s+)?(.*)$', t, re.I)
    if m:
        q, u, name = m.groups(); u = (u or '').lower()
        if u in ('ml', '') and re.fullmatch(r'\d+(?:\.\d+)?', q) and (u == 'ml' or re.search(r'juice', name, re.I)):
            return [zh_ing(name), round(float(q))]
        if u == 'cl': return [zh_ing(name), round(float(q) * 10)]
        if 'sprig' in name.lower() and not u: u = 'sprigs'
        qq = q.replace(' to ', '–').replace('-', '–').replace(' ', '')
        if u in ('pc', 'pcs', '') and re.search(r'mint leaves|basil', name, re.I): u = 'leaves'
        return [zh_ing(name), f'{qq} {UNIT.get(u, "个" if not u else u)}'.strip()]
    zh = zh_ing(t)
    return [zh, '补满' if re.search(r'soda|cola|ginger beer|ginger ale|sparkling', low) else '适量']


ACTIONS = {'shake': '摇和', 'stir': '搅拌', 'build': '杯中直调', 'blend': '搅拌机', 'swizzle': '搅棒调和', 'muddle': '捣压'}


def method_of(acts):
    if 'shake' in acts: return '摇和'
    if 'blend' in acts: return '搅拌机'
    if 'swizzle' in acts: return '搅棒调和'
    if 'build' in acts or ('stir' in acts and 'strain' not in acts): return '杯中直调'
    if 'stir' in acts: return '搅拌'
    return '直接倒入'


def glass_of(text, acts):
    if re.search(r'高球|高杯|柯林斯|细高|copo|Nora|Julep|笛形|香槟杯', text): return 'highball'
    if re.search(r'古典杯|岩石杯', text): return 'rocks'
    if re.search(r'鸡尾酒杯|马天尼', text): return 'coupe' if 'shake' in acts else 'martini'
    if 'top' in acts or 'build' in acts: return 'highball'
    if 'strain' in acts or 'double_strain' in acts: return 'coupe' if 'shake' in acts else 'martini'
    return 'rocks'


COLORS = [(r'番茄|血腥', '#b8322a'), (r'金巴利|红石榴|红葡萄|红衣', '#c22b2c'), (r'阿佩罗|卡佩莱蒂', '#e8642c'),
          (r'咖啡|可乐|深色可可|黑朗姆|黑糖蜜', '#4a2a1a'), (r'蔓越莓|覆盆子|黑加仑|黑莓|樱桃', '#d24a6a'),
          (r'绿薄荷|绿查特', '#7fbf6a'), (r'鲜奶油|椰浆|蛋', '#efe6d2'), (r'紫罗兰', '#b9a6d8'),
          (r'甜味美思|威士忌|干邑|白兰地|陈年朗姆|波特|阿玛罗|菲奈特', '#c47a2c'), (r'橙汁|百香果|芒果|菠萝', '#f2b134'),
          (r'青柠|薄荷', '#dcecc0'), (r'柠檬', '#f0e3a6'), (r'香槟|普罗塞克|起泡', '#f3e6b0')]


def color_of(names):
    s = ' '.join(names)
    for pat, c in COLORS:
        if re.search(pat, s): return c
    return '#ecebe0'


def garnish_of(g):
    g = (g or '').lower()
    if 'olive' in g: return 'olive'
    if 'cherry' in g: return 'cherry'
    if 'mint' in g: return 'mint'
    if 'salt' in g: return 'salt'
    if 'lime' in g: return 'lime'
    if 'lemon' in g and ('wheel' in g or 'slice' in g): return 'lemon'
    if 'lemon' in g: return 'lemon-twist'
    if 'orange' in g: return 'orange'
    return 'none'


def base_spirit(parts):
    for n, _ in parts:
        for k in ['金酒', '伏特加', '威士忌', '朗姆', '龙舌兰', '梅斯卡尔', '干邑', '白兰地', '皮斯科', '卡莎萨', '香槟', '普罗塞克', '雪莉']:
            if k in n: return k
    return None


out = []
for r in kb['catalog']:
    acts = [s['action'] for s in r['steps']]
    steps = ['完成装饰（按装饰说明）' if 'Garnish 字段' in s['instruction'] else s['instruction'] for s in r['steps']]
    parts = [parse(i['source_text']) for i in r['ingredients']]
    src = sources.get(r['source_id'], {})
    method = method_of(acts)
    base = base_spirit(parts)
    publisher = src.get('publisher') or ''
    note = (f'以{base}为基酒，' if base else '') + f'{method}。' + (' 来源：IBA 官方配方。' if publisher == 'IBA' else f' 来源：{publisher}。' if publisher else '')
    rid = r['id'][4:] if r['id'].startswith('iba-') else r['id']
    out.append({
        'id': rid, 'kb': r['id'], 'name': NAMES.get(r['name'], r['name']), 'en': r['name'],
        'shake': 'shake' in acts, 'method': method, 'glass': glass_of(' '.join(steps), acts),
        'color': color_of([p[0] for p in parts]), 'garnish': garnish_of(r.get('garnish_source_text')),
        'note': note.strip(), 'parts': parts, 'partsSource': [i['source_text'] for i in r['ingredients']],
        'deco': r.get('garnish_source_text') or '无', 'decoSource': True, 'steps': steps,
        'branches': [b.get('label') or b.get('condition') or '' for b in r.get('conditional_branches', []) if isinstance(b, dict)],
        'source': {'publisher': publisher, 'url': src.get('url'), 'checked': (src.get('checked_at') or '')[:10]},
        'recipeVersion': r['recipe_version'], 'reference': r['reference_binding']['status'],
        'shakeStep': next((s['step_id'] for s in r['steps'] if s['action'] == 'shake'), None),
        # 酒款照片：知识库 image 字段，网页用 photos/cocktails/ 里压缩过的 webp（scripts/ 外手动转换，见 README）
        'photo': ('photos/cocktails/' + Path(r['image']['url']).stem + '.webp') if (r.get('image') or {}).get('url') else None,
        # 练习时的完整步骤：知识库每一步的动作类型 + 说明
        'flow': [{'action': st['action'], 'text': st['instruction']} for st in r['steps']],
    })

js = ('/* 由 scripts/build_catalog.py 从 调酒知识库/网站图鉴接口.json 生成，别手改 */\n'
      'window.CATALOG = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
(root / 'catalog.js').write_text(js, encoding='utf-8')
untranslated = sorted({p[0] for c in out for p in c['parts'] if re.search(r'[A-Za-z]{3,}', p[0]) and not re.search(r'[一-龥]', p[0])})
print(f'{len(out)} 款，摇和 {sum(c["shake"] for c in out)} 款 → catalog.js（{len(js) // 1024} KB）')
print('没译到的配料：', untranslated)
print('没译到的酒名：', [c['en'] for c in out if c['name'] == c['en']])
