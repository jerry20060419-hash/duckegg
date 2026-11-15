// ============================================================================
// 《蛋裡是什麼鴨：雙人連線大農場 ＆ Boss 共鬥版》
// 基因部位資料庫、戰力數值系統、套裝共鳴、Boss 難度與稀有度權重定義
// ============================================================================

const RARITIES = {
  common: {
    id: 'common',
    name: '普通',
    color: '#e2e8f0',
    border: '#94a3b8',
    bg: 'rgba(148, 163, 184, 0.18)',
    eggColor: '#fffbeb',
    eggSpot: '#fde68a',
    sacrificeValue: 8,
    pitPoints: 10,
    basePartPower: 40,
    // 嚴格調低高階出貨率：普通佔絕大多數，讓稀有度真正具有養成價值
    probWeight: 780
  },
  rare: {
    id: 'rare',
    name: '罕見',
    color: '#38bdf8',
    border: '#0284c7',
    bg: 'rgba(56, 189, 248, 0.18)',
    eggColor: '#e0f2fe',
    eggSpot: '#38bdf8',
    sacrificeValue: 22,
    pitPoints: 18,
    basePartPower: 110,
    probWeight: 165
  },
  epic: {
    id: 'epic',
    name: '勁爆',
    color: '#c084fc',
    border: '#9333ea',
    bg: 'rgba(192, 132, 252, 0.20)',
    eggColor: '#f3e8ff',
    eggSpot: '#a855f7',
    sacrificeValue: 55,
    pitPoints: 30,
    basePartPower: 260,
    probWeight: 42
  },
  legendary: {
    id: 'legendary',
    name: '傳奇',
    color: '#facc15',
    border: '#ca8a04',
    bg: 'rgba(250, 204, 21, 0.22)',
    eggColor: '#fef9c3',
    eggSpot: '#eab308',
    sacrificeValue: 135,
    pitPoints: 50,
    basePartPower: 620,
    probWeight: 11
  },
  cursed: {
    id: 'cursed',
    name: '詛咒',
    color: '#f43f5e',
    border: '#be123c',
    bg: 'rgba(244, 63, 94, 0.25)',
    eggColor: '#27121b',
    eggSpot: '#f43f5e',
    sacrificeValue: 320,
    pitPoints: 80,
    basePartPower: 1350,
    probWeight: 2
  }
};

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'cursed'];

// 孵化倒計時秒數設定：非變異蛋 60 秒 (1分鐘)、變異蛋 180 秒 (3分鐘)
const HATCH_TIME_NORMAL_SEC = 60;
const HATCH_TIME_MUTATED_SEC = 180;

// 公母交配區設定：每個領地最多 3 組交配室，每組產卵時間延長 3 倍 (60秒產1顆蛋)，變異蛋機率 3%
const MAX_BREED_ROOMS = 3;
const BREED_TIME_SEC = 60;
const MUTATED_EGG_CHANCE = 0.03;

// 每階 Boss 召喚所需獻祭鴨子數量：統一為 30 隻
const BOSS_SACRIFICE_REQ_COUNT = 30;
const BOSS_RAID_DURATION_SEC = 90;

// 每位玩家出戰小隊上限：3 隻（雙人聯合隊伍共 6 隻一同圍攻 Boss）
const MAX_SQUAD_SIZE = 3;

// 15 套完整基因主題（每個部位皆有專屬戰力值 power，越稀有戰力越高！）
const DUCK_SETS = [
  {
    setId: 'classic',
    setName: '經典小黃鴨',
    rarity: 'common',
    skillName: '呆毛衝撞',
    projColor: '#fde047',
    setDesc: '看似最普通的小黃鴨，但成群結隊時啄人也是很痛的。',
    head: { id: 'h_classic', name: '呆毛小黃頭', power: 38, desc: '頭頂有一撮永遠梳不平的呆毛。' },
    wing: { id: 'w_classic', name: '嫩黃小短翅', power: 35, desc: '拍動起來毫無飛行能力，只能用來搧風。' },
    body: { id: 'b_classic', name: '圓滾滾鴨肚', power: 42, desc: '脂肪含量極高，浮在水面上像顆大檸檬。' }
  },
  {
    setId: 'sprout',
    setName: '光合作用盆栽鴨',
    rarity: 'common',
    skillName: '飛葉快刀',
    projColor: '#4ade80',
    setDesc: '只要曬太陽就能飽足的環保鴨，偶爾會射出鋒利葉片。',
    head: { id: 'h_sprout', name: '嫩綠豆芽頭', power: 45, desc: '頭頂長出一株翠綠小幼苗，心情好時會開花。' },
    wing: { id: 'w_sprout', name: '闊葉芭蕉扇', power: 44, desc: '兩片大葉子取代了翅膀，散發淡淡青草香。' },
    body: { id: 'b_sprout', name: '陶土花盆身', power: 46, desc: '下半身直接塞進泥土花盆裡，防禦力意外不錯。' }
  },
  {
    setId: 'breakfast',
    setName: '元氣早餐吐司鴨',
    rarity: 'common',
    skillName: '熱油培根甩擊',
    projColor: '#fb923c',
    setDesc: '聞起來有濃郁奶油香，用滾燙的荷包蛋攻擊敵人。',
    head: { id: 'h_breakfast', name: '半熟荷包蛋頭', power: 48, desc: '頭頂趴著一顆流心荷包蛋，蛋黃還會晃動。' },
    wing: { id: 'w_breakfast', name: '香脆培根翅', power: 50, desc: '油亮亮的焦香培根條，揮動時會甩出熱油花。' },
    body: { id: 'b_breakfast', name: '厚片烤吐司身', power: 52, desc: '烤得微焦的方形厚片吐司，四角非常紮實。' }
  },
  {
    setId: 'barber',
    setName: '失控理髮師鴨',
    rarity: 'rare',
    skillName: '奪命連環剪',
    projColor: '#94a3b8',
    setDesc: '號稱鴨場首席造型師，剪刀揮舞起來連Boss觸手都能剪斷。',
    head: { id: 'h_barber', name: '飛機頭浪子', power: 105, desc: '抹了三罐髮膠固定出的超長暴走飛機頭。' },
    wing: { id: 'w_barber', name: '咔嚓大剪刀翅', power: 125, desc: '翅膀完全金屬化成兩把鋒利的裁縫大剪刀。' },
    body: { id: 'b_barber', name: '三色旋轉燈身', power: 100, desc: '像傳統理髮廳門口的紅白藍轉燈，會不斷旋轉。' }
  },
  {
    setId: 'muscle',
    setName: '館長級健美猛鴨',
    rarity: 'rare',
    skillName: '百公斤重拳',
    projColor: '#f59e0b',
    setDesc: '每天在鴨窩做五百下伏地挺身，連黑洞巨怪都不敢輕易惹牠。',
    head: { id: 'h_muscle', name: '硬漢寸頭綁帶', power: 115, desc: '綁著必勝紅頭帶、眼神兇狠的猛男鴨頭。' },
    wing: { id: 'w_muscle', name: '爆筋二頭肌臂', power: 140, desc: '根本不是翅膀，是兩條舉著啞鈴的粗壯人類手臂！' },
    body: { id: 'b_muscle', name: '八塊腹肌胸膛', power: 125, desc: '抹了古銅色嬰兒油的完美八塊腹肌。' }
  },
  {
    setId: 'knight',
    setName: '石中劍落難勇者',
    rarity: 'rare',
    skillName: '聖劍十字斬',
    projColor: '#38bdf8',
    setDesc: '原本想去討伐魔王，結果不小心把聖劍插在自己腦袋上。',
    head: { id: 'h_knight', name: '聖劍插腦頭', power: 130, desc: '一把傳說聖劍直接貫穿頭頂，拔出來威力驚人。' },
    wing: { id: 'w_knight', name: '皇家紋章盾翅', power: 120, desc: '左盾右劍的鋼鐵武裝，攻守兼備。' },
    body: { id: 'b_knight', name: '鎖子甲戰馬身', power: 118, desc: '穿著沉重鐵甲還套著玩具木馬圈的奇妙身軀。' }
  },
  {
    setId: 'ninja',
    setName: '影分身暗部忍鴨',
    rarity: 'rare',
    skillName: '風魔手裡劍風暴',
    projColor: '#818cf8',
    setDesc: '專精於暗殺與高速投擲手裡劍的神秘忍鴨流派。',
    head: { id: 'h_ninja', name: '木葉蒙面護額', power: 118, desc: '只露出一雙犀利死魚眼的深藍忍者頭巾。' },
    wing: { id: 'w_ninja', name: '風魔手裡劍翅', power: 138, desc: '高速旋轉的巨大十字手裡劍，暴擊率極高。' },
    body: { id: 'b_ninja', name: '替身木頭段身', power: 112, desc: '遇到危險時會噗一聲變成一段綁著繩子的木頭。' }
  },
  {
    setId: 'wizard',
    setName: '大魔導煉金術鴨',
    rarity: 'epic',
    skillName: '奧術隕石轟炸',
    projColor: '#c084fc',
    setDesc: '掌控禁忌煉金與深淵奧術，能對Boss造成毀滅性魔法傷害。',
    head: { id: 'h_wizard', name: '星辰巫師高帽', power: 265, desc: '戴著鑲滿發光星星的歪斜紫絨巫師帽與白鬍子。' },
    wing: { id: 'w_wizard', name: '浮游魔導書翅', power: 280, desc: '翅膀旁漂浮著自動翻頁的古老法術書與魔杖。' },
    body: { id: 'b_wizard', name: '沸騰魔藥瓶身', power: 255, desc: '透明玻璃肚裡裝著咕嚕咕嚕冒泡的紫色高爆藥水。' }
  },
  {
    setId: 'cyber',
    setName: '賽博龐克2077鴨',
    rarity: 'epic',
    skillName: '電漿軌道電磁砲',
    projColor: '#22d3ee',
    setDesc: '來自西元2077年的軍用武裝改造鴨，配備高能電漿雷射。',
    head: { id: 'h_cyber', name: '霓虹電子戰術眼', power: 275, desc: '配備紅外線弱點掃描目鏡與發光天線的半機械鴨頭。' },
    wing: { id: 'w_cyber', name: '電漿噴射推進翼', power: 290, desc: '噴出藍紫尾焰的渦輪機翼，可發射高溫電漿束。' },
    body: { id: 'b_cyber', name: '反重力懸浮碟身', power: 270, desc: '底盤裝有霓虹RGB燈條與磁軌砲底座。' }
  },
  {
    setId: 'retro',
    setName: '8-Bit 街機電玩鴨',
    rarity: 'epic',
    skillName: '像素雷射連射',
    projColor: '#f472b6',
    setDesc: '開啟金手指密技「上上下下左右左右BA」後戰力暴走。',
    head: { id: 'h_retro', name: '映像管電視機頭', power: 250, desc: '整顆頭是一台老式CRT厚電視，會發射像素光波。' },
    wing: { id: 'w_retro', name: '紅白機搖桿翅', power: 265, desc: '兩支帶著十字鍵與連發AB鍵的復古手把。' },
    body: { id: 'b_retro', name: '投幣式街機櫃身', power: 260, desc: '肚子上有投幣孔「INSERT COIN」，火力全開。' }
  },
  {
    setId: 'king',
    setName: '黃金帝國法老王鴨',
    rarity: 'legendary',
    skillName: '王之財寶・黃金劍雨',
    projColor: '#facc15',
    setDesc: '渾身散發土豪金光芒，打開黃金寶庫向Boss傾瀉無數神兵。',
    head: { id: 'h_king', name: '鑲鑽璀璨皇冠頭', power: 620, desc: '頂著沉甸甸的紅寶石純金王冠，神情無比高傲。' },
    wing: { id: 'w_king', name: '皇家天鵝絨披風', power: 640, desc: '鑲有白鼬毛邊的霸氣緋紅披風與黃金權杖。' },
    body: { id: 'b_king', name: '純金寶座龍椅身', power: 660, desc: '直接坐在鑲滿珠寶的移動式黃金王座上。' }
  },
  {
    setId: 'angel',
    setName: '六翼熾天使聖鴨',
    rarity: 'legendary',
    skillName: '天界聖光裁決',
    projColor: '#fef08a',
    setDesc: '基因突變的神聖奇蹟，召喚貫穿天地的聖光柱淨化深淵巨怪。',
    head: { id: 'h_angel', name: '聖潔光環聖詠頭', power: 650, desc: '頭頂懸浮著純金發光神聖光環，閉目微笑。' },
    wing: { id: 'w_angel', name: '六翼純白聖羽', power: 680, desc: '層層疊疊的潔白發光羽翼，揮動時降下聖光裁決。' },
    body: { id: 'b_angel', name: '雲端聖殿浮空身', power: 630, desc: '下半身籠罩在柔軟的金邊祥雲之中，神聖不可侵犯。' }
  },
  {
    setId: 'dragon',
    setName: '煉獄古龍霸王鴨',
    rarity: 'legendary',
    skillName: '滅世紅蓮龍息',
    projColor: '#ef4444',
    setDesc: '體內流淌著遠古巨龍基因，吐出的紅蓮龍息能融化一切。',
    head: { id: 'h_dragon', name: '黃金龍角噴火頭', power: 690, desc: '長著彎曲古龍大角，口中凝聚毀滅性的龍息吐息。' },
    wing: { id: 'w_dragon', name: '烈焰龍鱗雙翼', power: 660, desc: '強韌的赤紅龍翼，展開時自帶烈焰風暴。' },
    body: { id: 'b_dragon', name: '熔岩裝甲龍尾身', power: 670, desc: '覆蓋炙熱龍鱗與粗壯擺動龍尾的霸氣身軀。' }
  },
  {
    setId: 'cthulhu',
    setName: '深淵克蘇魯古神鴨',
    rarity: 'cursed',
    skillName: '舊日支配者精神衝擊',
    projColor: '#a855f7',
    setDesc: '從中央大黑洞深處爬回來的古神化身，連深淵Boss見了都要發抖。',
    head: { id: 'h_cthulhu', name: '不可名狀觸手頭', power: 1380, desc: '嘴巴周圍長滿扭動的深海章魚觸手與三顆邪眼。' },
    wing: { id: 'w_cthulhu', name: '深淵暗影蝠翼', power: 1340, desc: '滴落著黑紫色深淵黏液的詭異肉翅。' },
    body: { id: 'b_cthulhu', name: '八爪吸盤盤踞身', power: 1360, desc: '無數條巨大紫黑觸手盤根錯節組成的古神底座。' }
  },
  {
    setId: 'void',
    setName: '黑洞吞噬者・長頸詛咒鴨',
    rarity: 'cursed',
    skillName: '次元坍塌・奇點湮滅',
    projColor: '#f43f5e',
    setDesc: '吸收了黑洞巨怪的純粹詛咒能量，脖子長到突破天際的終極破壞神！',
    head: { id: 'h_void', name: '深淵百眼魔神頭', power: 1480, desc: '脖子極度拉長、頭上睜開數顆發射毀滅死光的深淵之眼。' },
    wing: { id: 'w_void', name: '虛空裂隙死神鐮', power: 1450, desc: '由空間裂縫與駭人骨鐮構成的詛咒雙翼。' },
    body: { id: 'b_void', name: '微型黑洞漩渦身', power: 1420, desc: '身體中心就是一個不斷旋轉吞噬光線的超重力黑洞。' }
  }
];

const PARTS_DB = {
  head: {},
  wing: {},
  body: {}
};

DUCK_SETS.forEach(s => {
  PARTS_DB.head[s.head.id] = { ...s.head, partType: 'head', setId: s.setId, setName: s.setName, rarity: s.rarity, skillName: s.skillName, projColor: s.projColor };
  PARTS_DB.wing[s.wing.id] = { ...s.wing, partType: 'wing', setId: s.setId, setName: s.setName, rarity: s.rarity, skillName: s.skillName, projColor: s.projColor };
  PARTS_DB.body[s.body.id] = { ...s.body, partType: 'body', setId: s.setId, setName: s.setName, rarity: s.rarity, skillName: s.skillName, projColor: s.projColor };
});

// 5 個連線組隊共鬥 Boss 階級 (每階皆需獻祭 30 隻對應品質鴨子才可召喚，且越稀有的 Boss 血量、裝甲減傷與難度大幅躍升！)
const BOSS_TIERS = [
  {
    id: 'boss_1',
    rarityTier: '普通級',
    name: '🐙 Lv.1 深淵百眼觸手怪 (普通Boss)',
    maxHp: 35000,
    armorReduction: 0.0,
    recPower: 450,
    coinReward: 320,
    reqType: 'total',
    reqCount: 30,
    reqLabel: '累計獻祭 30 隻任意鴨子',
    dropTable: { common: 0.25, rare: 0.62, epic: 0.13, legendary: 0, cursed: 0 },
    color: '#94a3b8',
    desc: '【普通級難度｜護甲減傷 0%｜限時90秒】適合初期 3+3 聯合小隊討伐！掉落【罕見 / 勁爆】變異蛋。'
  },
  {
    id: 'boss_2',
    rarityTier: '罕見級',
    name: '🐍 Lv.2 煉獄九頭奇美拉鴨 (罕見Boss)',
    maxHp: 165000,
    armorReduction: 0.22,
    recPower: 1850,
    coinReward: 850,
    reqType: 'rarePlus',
    reqCount: 30,
    reqLabel: '累計獻祭 30 隻【罕見(藍)】以上鴨子',
    dropTable: { common: 0, rare: 0.42, epic: 0.50, legendary: 0.08, cursed: 0 },
    color: '#38bdf8',
    desc: '【罕見級難度｜重裝減傷 22%｜限時90秒】吞噬30隻藍鴨誕生的魔獸！戰力不足將受裝甲壓制，掉落【勁爆 / 傳奇】變異蛋。'
  },
  {
    id: 'boss_3',
    rarityTier: '勁爆級',
    name: '👁️ Lv.3 虛空克蘇魯古神 (勁爆Boss)',
    maxHp: 720000,
    armorReduction: 0.40,
    recPower: 5600,
    coinReward: 2200,
    reqType: 'epicPlus',
    reqCount: 30,
    reqLabel: '累計獻祭 30 隻【勁爆(紫)】以上鴨子',
    dropTable: { common: 0, rare: 0, epic: 0.60, legendary: 0.35, cursed: 0.05 },
    color: '#c084fc',
    desc: '【勁爆級難度｜深淵護盾減傷 40%｜限時90秒】高強度深淵支配者！需高戰力紫/金鴨聯手破防，小機率掉落【詛咒】基因！'
  },
  {
    id: 'boss_4',
    rarityTier: '傳奇級',
    name: '🐉 Lv.4 星界黃金聖裁龍皇 (傳奇Boss)',
    maxHp: 2800000,
    armorReduction: 0.55,
    recPower: 15500,
    coinReward: 5500,
    reqType: 'legendaryOrSet',
    reqCount: 30,
    reqLabel: '累計獻祭 30 隻【傳奇(金)/詛咒】或【👑套裝覺醒鴨】',
    dropTable: { common: 0, rare: 0, epic: 0.20, legendary: 0.60, cursed: 0.20 },
    color: '#eab308',
    desc: '【傳奇級難度｜龍鱗減傷 55%｜限時90秒】極高難度龍皇！雙人必須湊齊高階套裝戰鴨才能在時間內擊破！'
  },
  {
    id: 'boss_5',
    rarityTier: '詛咒神話級',
    name: '🌌 Lv.5 終焉次元吞噬魔神 (詛咒Boss)',
    maxHp: 9800000,
    armorReduction: 0.70,
    recPower: 42000,
    coinReward: 14000,
    reqType: 'cursedOrHighSet',
    reqCount: 30,
    reqLabel: '累計獻祭 30 隻【詛咒(紅)】或【紫/金/紅套裝覺醒鴨】',
    dropTable: { common: 0, rare: 0, epic: 0, legendary: 0.52, cursed: 0.48 },
    color: '#f43f5e',
    desc: '【神話終焉難度｜次元障壁減傷 70%｜限時90秒】全遊戲最恐怖的滅世魔神！唯有雙人頂配詛咒/傳奇套裝戰隊方能戰勝！'
  }
];

const GRAFFITI_STAMPS = [
  { id: 'mustache', icon: '🥸', name: '怪盜八字鬍', text: '小偷畫上了滑稽的翹鬍子！' },
  { id: 'poop', icon: '💩', name: '黃金便便印', text: '蛋殼上被畫了一坨微笑便便！' },
  { id: 'devil', icon: '😈', name: '惡魔塗鴉臉', text: '被畫上了壞笑惡魔塗鴉！' },
  { id: 'kiss', icon: '💋', name: '香吻到此一遊', text: '留下了鮮紅唇印：借顆分身蛋謝啦！' },
  { id: 'crown', icon: '👑', name: '笨蛋王冠', text: '上面寫著「這顆蛋歸怪盜摸走囉」！' }
];

const FUNNY_DUCK_NAMES = [
  '呱吉拉', '蛋黃哥二世', '不講武德鴨', '深淵備用糧', '隔壁老王鴨',
  '脖子扭到鴨', '香脆烤鴨預備軍', '哲學思考鴨', '量子力學鴨', '加班社畜鴨',
  '絕命毒師鴨', '全村的希望', '基因車禍現場', '媽媽說我長得很特別', '黑洞VIP會員',
  '三杯鴨候選人', '禿頭披風鴨', '半夜會發光', '走路會劈叉', '呆毛永動機'
];

// 計算單隻鴨子的綜合稀有度、套裝共鳴與【戰鬥力 Combat Power】
function evaluateDuckInfo(duck) {
  const h = PARTS_DB.head[duck.head] || PARTS_DB.head['h_classic'];
  const w = PARTS_DB.wing[duck.wing] || PARTS_DB.wing['w_classic'];
  const b = PARTS_DB.body[duck.body] || PARTS_DB.body['b_classic'];

  const maxIdx = Math.max(
    RARITY_ORDER.indexOf(h.rarity),
    RARITY_ORDER.indexOf(w.rarity),
    RARITY_ORDER.indexOf(b.rarity)
  );
  const topRarityKey = RARITY_ORDER[Math.max(0, maxIdx)] || 'common';
  const rarityObj = RARITIES[topRarityKey];

  const isFullSet = (h.setId === w.setId && w.setId === b.setId);
  const matchedSet = isFullSet ? DUCK_SETS.find(s => s.setId === h.setId) : null;

  const rawPower = (h.power || 40) + (w.power || 40) + (b.power || 40);
  const genBonus = 1 + Math.min(1.0, ((duck.gen || 1) - 1) * 0.05);
  const setMult = isFullSet ? 1.5 : 1.0;
  const combatPower = Math.round(rawPower * genBonus * setMult);

  return {
    headPart: h,
    wingPart: w,
    bodyPart: b,
    rarityKey: topRarityKey,
    rarity: rarityObj,
    isFullSet,
    matchedSet,
    combatPower,
    skillName: matchedSet ? `【覺醒】${matchedSet.skillName}` : h.skillName,
    projColor: matchedSet ? matchedSet.projColor : h.projColor
  };
}

function formatDurationMMSS(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

window.RARITIES = RARITIES;
window.RARITY_ORDER = RARITY_ORDER;
window.HATCH_TIME_NORMAL_SEC = HATCH_TIME_NORMAL_SEC;
window.HATCH_TIME_MUTATED_SEC = HATCH_TIME_MUTATED_SEC;
window.MAX_BREED_ROOMS = MAX_BREED_ROOMS;
window.BREED_TIME_SEC = BREED_TIME_SEC;
window.MUTATED_EGG_CHANCE = MUTATED_EGG_CHANCE;
window.BOSS_SACRIFICE_REQ_COUNT = BOSS_SACRIFICE_REQ_COUNT;
window.BOSS_RAID_DURATION_SEC = BOSS_RAID_DURATION_SEC;
window.MAX_SQUAD_SIZE = MAX_SQUAD_SIZE;
window.DUCK_SETS = DUCK_SETS;
window.PARTS_DB = PARTS_DB;
window.BOSS_TIERS = BOSS_TIERS;
window.GRAFFITI_STAMPS = GRAFFITI_STAMPS;
window.FUNNY_DUCK_NAMES = FUNNY_DUCK_NAMES;
window.evaluateDuckInfo = evaluateDuckInfo;
window.formatDurationMMSS = formatDurationMMSS;
