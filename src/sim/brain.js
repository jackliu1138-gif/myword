// A villager's mind, shared by the game and the server (no browser needed):
// - who each villager is: a name, a character, a quirk and a voice that follow from its uid, so
//   every player sees the same villager;
// - the prompt for a language model, when there is one, and how its answer is read;
// - what a villager says without a model (or when the model can't be reached in time);
// - the few things a villager may do besides talk: ask for a hand (a task with a reward), give a
//   small present, knock a little off its prices, follow you for a while. Whatever a model says it
//   wants to do is checked here, so nobody talks a villager out of a stack of diamonds;
// - what a villager remembers of each player: the last few exchanges, things that happened
//   (presents, tasks, a punch...) and how well it likes them.

import { ITEM, itemDef } from './items.js';
import { BLOCK, BLOCKS } from '../world/blocks.js';

export const MOODS = ['happy', 'sad', 'angry', 'scared', 'surprised', 'neutral'];
const MAX_MEM = 8; // exchanges remembered per player
const MAX_FACTS = 10;

// ---------------------------------------------------------------- small helpers
export function hash32(s) {
  let h = 2166136261;
  s = String(s);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
// a small seeded generator (mulberry32)
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, list) => list[Math.floor(rnd() * list.length) % list.length];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// one line of text: no control characters, no markdown, at most n characters
export function clip(s, n = 160) {
  let t = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > n) t = t.slice(0, n - 1).trimEnd() + '…';
  return t;
}
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));

// ---------------------------------------------------------------- things villagers deal in
// An item or block by its key ('wheat', 'white_wool'): its id, or 0.
export function stuffId(key) {
  if (typeof key !== 'string' || !/^[a-z_]{2,32}$/.test(key)) return 0;
  const id = ITEM[key.toUpperCase()];
  if (id) return id;
  const b = BLOCK[key.toUpperCase()];
  return b && BLOCKS[b] ? b : 0;
}
export function stuffName(key, lang) {
  const id = stuffId(key);
  if (!id) return key;
  const d = id >= 256 ? itemDef(id) : BLOCKS[id];
  if (!d) return key;
  if (lang === 'zh' && d.zh) return d.zh;
  return d.name || key.replace(/_/g, ' ');
}

// what each trade asks a hand with: [item, fewest, most]
export const WANTS = {
  farmer: [['wheat', 8, 20], ['carrot', 6, 16], ['potato', 6, 16], ['pumpkin', 2, 6], ['melon_slice', 6, 16], ['bone', 4, 10]],
  fisherman: [['string', 4, 12], ['coal', 4, 10], ['raw_cod', 4, 10], ['raw_salmon', 3, 8], ['stick', 8, 16]],
  shepherd: [['white_wool', 4, 12], ['shears', 1, 1], ['wheat', 6, 16]],
  fletcher: [['stick', 12, 32], ['feather', 4, 12], ['flint', 4, 10], ['string', 4, 10]],
  librarian: [['paper', 8, 24], ['book', 1, 4], ['ink_sac', 2, 6], ['feather', 2, 6]],
  cartographer: [['paper', 8, 24], ['glass_pane', 4, 12], ['iron_ingot', 1, 4]],
  cleric: [['rotten_flesh', 8, 24], ['gold_ingot', 1, 4], ['glass_bottle', 2, 6], ['bone', 4, 12]],
  armorer: [['coal', 8, 20], ['iron_ingot', 3, 8]],
  weaponsmith: [['coal', 8, 20], ['iron_ingot', 3, 8], ['flint', 4, 8]],
  toolsmith: [['coal', 8, 20], ['iron_ingot', 3, 8], ['stick', 8, 16]],
  butcher: [['raw_beef', 3, 8], ['raw_chicken', 3, 8], ['raw_porkchop', 3, 8], ['raw_mutton', 3, 8], ['coal', 6, 12]],
  leatherworker: [['leather', 4, 12], ['string', 4, 10]],
  mason: [['clay_ball', 8, 20], ['cobblestone', 16, 32], ['stone', 16, 32], ['sand', 8, 20]],
  none: [['bread', 2, 6], ['apple', 2, 6], ['oak_log', 8, 16], ['dandelion', 2, 6]],
  nitwit: [['dandelion', 1, 5], ['poppy', 1, 5], ['cookie', 2, 6], ['apple', 1, 4]],
};
// what a task may be rewarded with, and the most of it
export const REWARDS = { emerald: 8, bread: 6, cooked_beef: 4, cooked_porkchop: 4, iron_ingot: 3, golden_carrot: 2, arrow: 16, book: 2, cookie: 8, apple: 6, coal: 16, lapis_lazuli: 8, gold_ingot: 2 };
// presents a villager may give (once a day, to a friend), and the most of each
export const GIFTS = { bread: 3, apple: 3, cookie: 4, carrot: 4, potato: 4, cooked_cod: 2, poppy: 2, dandelion: 2, emerald: 1, wheat: 6, melon_slice: 4, pumpkin_pie: 1, paper: 4, arrow: 8, torch: 4 };
const allWants = () => [...new Set(Object.values(WANTS).flat().map((w) => w[0]))];

// ---------------------------------------------------------------- who a villager is
export const JOBS = {
  none: ['村民', 'villager', '没有固定的活儿，平时帮大家干点杂事', 'has no trade, and helps out wherever needed'],
  farmer: ['农民', 'farmer', '种小麦、胡萝卜和马铃薯，最关心收成', 'grows wheat, carrots and potatoes, and worries about the harvest'],
  fisherman: ['渔夫', 'fisherman', '天天在河边钓鱼，知道哪儿鱼多', 'fishes by the river every day and knows where the fish are'],
  shepherd: ['牧羊人', 'shepherd', '养羊、剪羊毛、染各种颜色的羊毛', 'keeps sheep, shears and dyes their wool'],
  fletcher: ['制箭师', 'fletcher', '做弓和箭，对羽毛和燧石很挑剔', 'makes bows and arrows and is fussy about feathers and flint'],
  librarian: ['图书管理员', 'librarian', '管着村里的书，懂附魔书，爱讲道理', 'keeps the village books, knows enchanted books, and likes to explain things'],
  cartographer: ['制图师', 'cartographer', '画地图，知道远处的神殿和府邸', 'draws maps and has heard of far-off temples and mansions'],
  cleric: ['牧师', 'cleric', '懂药水和附魔材料，说话慢条斯理', 'knows potions and enchanting, and speaks slowly and kindly'],
  armorer: ['盔甲匠', 'armorer', '打造盔甲，力气大，嗓门也大', 'makes armour, strong and loud'],
  weaponsmith: ['武器匠', 'weaponsmith', '打造剑和斧，对打怪很有心得', 'makes swords and axes and knows a lot about fighting monsters'],
  toolsmith: ['工具匠', 'toolsmith', '打造镐和锹，总说工具要爱惜', 'makes pickaxes and shovels and says tools should be looked after'],
  butcher: ['屠夫', 'butcher', '卖肉和烤肉，手艺好', 'sells meat and cooks it well'],
  leatherworker: ['皮匠', 'leatherworker', '用皮革做衣服和马鞍', 'makes leather clothes and saddles'],
  mason: ['石匠', 'mason', '砌石头、烧砖、做陶瓦，盖房子是行家', 'cuts stone, fires bricks and terracotta, and knows building'],
  nitwit: ['闲人', 'nitwit', '啥活儿也不会，整天到处晃悠，但人很好玩', 'does no work at all, wanders about, and is great fun'],
};
const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗', '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧'];
const GIVEN = {
  male: ['铁柱', '大山', '建国', '小虎', '长贵', '福生', '石头', '金宝', '春生', '有才', '德胜', '守田', '满仓', '二牛', '国强', '永福', '老根', '顺子'],
  female: ['秀英', '桂兰', '小梅', '春花', '翠花', '玉兰', '巧儿', '秀莲', '凤霞', '丽娟', '红霞', '小芳', '桂芝', '月娥', '喜妹', '彩云'],
};
const EN_NAMES = {
  male: ['Tom', 'Ben', 'Walter', 'Hugo', 'Arthur', 'Ned', 'Jasper', 'Owen', 'Felix', 'Gus', 'Theo', 'Barnaby', 'Silas', 'Milo', 'Rufus', 'Alfie'],
  female: ['Martha', 'Rosie', 'Agnes', 'Clara', 'Mabel', 'Ivy', 'Nell', 'Hattie', 'Dora', 'Elsie', 'Greta', 'Lottie', 'Maud', 'Flora', 'Winnie', 'Poppy'],
};
export const TRAITS = {
  kind: ['热心肠', 'kind-hearted'], chatty: ['爱唠叨', 'chatty'], timid: ['胆子小', 'timid'], curious: ['好奇心重', 'curious'],
  grumpy: ['有点倔脾气', 'a bit grumpy'], funny: ['爱开玩笑', 'loves a joke'], boastful: ['爱吹牛', 'a bit of a boaster'], thrifty: ['精打细算', 'thrifty'],
  generous: ['大方', 'generous'], storyteller: ['爱讲故事', 'loves telling stories'], superstitious: ['有点迷信', 'superstitious'], hardworking: ['勤快', 'hard-working'],
  lazy: ['有点懒', 'a little lazy'], shy: ['害羞', 'shy'], proud: ['好面子', 'proud'], gossip: ['爱打听八卦', 'loves gossip'],
};
const QUIRKS = [
  ['怕苦力怕怕得要命', 'is terrified of creepers'], ['梦想有一天去下界看看', 'dreams of seeing the Nether one day'],
  ['养了一只橘猫', 'has a ginger cat'], ['最讨厌下雨天', 'hates rainy days'], ['自称是村里最会做饭的人', 'claims to be the best cook in the village'],
  ['总觉得晚上有人在偷看村子', 'is sure something watches the village at night'], ['喜欢收集好看的花', 'collects pretty flowers'],
  ['说年轻时去过末地，可谁也不信', 'claims to have been to the End when young, though nobody believes it'], ['会背好几首诗', 'can recite several poems'],
  ['特别崇拜铁傀儡', 'idolises the iron golem'], ['一直想学会游泳', 'has always wanted to learn to swim'], ['喜欢晚上数星星', 'likes counting the stars at night'],
  ['相信月亮上住着人', 'believes people live on the moon'], ['每天早上第一个起床', 'is always first up in the morning'],
  ['偷偷攒绿宝石，想盖一座大房子', 'is secretly saving emeralds for a big house'], ['觉得羊会说话，只是不想说', 'thinks sheep could talk if they wanted to'],
];
const CATCH = { zh: ['哎呀', '嘿嘿', '我跟你说啊', '俺寻思', '可不是嘛', '哼哼', '嗯呐', '哈哈'], en: ['Well now', 'Hmm-hmm', 'I tell you', 'Goodness', 'Ha!', 'Mind you', 'Oh my', 'Right then'] };

// Everything about a villager that never changes: the same for everyone, from its uid.
export function personaFor(uid, job = 'none') {
  const rnd = seeded(hash32('villager:' + uid));
  const gender = rnd() < 0.5 ? 'male' : 'female';
  const age = pick(rnd, ['young', 'middle', 'middle', 'old']);
  const surname = pick(rnd, SURNAMES);
  const given = pick(rnd, GIVEN[gender]);
  const en = pick(rnd, EN_NAMES[gender]);
  const call = age === 'old' ? surname + (gender === 'male' ? '大爷' : '奶奶') : age === 'middle' ? (rnd() < 0.5 ? surname + given : surname + (gender === 'male' ? '叔' : '婶')) : surname + given;
  const enCall = age === 'old' ? (gender === 'male' ? 'Old ' : 'Granny ') + en : age === 'young' ? 'Young ' + en : en;
  const keys = Object.keys(TRAITS);
  const t1 = pick(rnd, keys);
  let t2 = pick(rnd, keys);
  if (t2 === t1) t2 = keys[(keys.indexOf(t1) + 5) % keys.length];
  const quirk = Math.floor(rnd() * QUIRKS.length);
  const catchIdx = Math.floor(rnd() * CATCH.zh.length);
  // a voice to go with them: lower for men and the old, a little faster for the young
  const pitch = gender === 'male' ? 0.72 + rnd() * 0.22 - (age === 'old' ? 0.08 : 0) : 1.08 + rnd() * 0.25 - (age === 'old' ? 0.1 : 0);
  const rate = age === 'old' ? 0.86 + rnd() * 0.08 : age === 'young' ? 1.02 + rnd() * 0.1 : 0.94 + rnd() * 0.1;
  return {
    uid: String(uid), job: JOBS[job] ? job : 'none', gender, age,
    name: { zh: call, en: enCall }, full: { zh: surname + given, en: en },
    traits: [t1, t2], quirk, catchIdx,
    voice: { pitch: Math.round(pitch * 100) / 100, rate: Math.round(rate * 100) / 100 },
  };
}
export const personaName = (p, lang) => (lang === 'zh' ? p.name.zh : p.name.en);
export const jobName = (job, lang) => (JOBS[job] || JOBS.none)[lang === 'zh' ? 0 : 1];
const catchOf = (p, lang) => CATCH[lang === 'zh' ? 'zh' : 'en'][p.catchIdx % CATCH.zh.length];

// ---------------------------------------------------------------- what a villager remembers
// One villager's memory of one player.
export function newRecord(day = 0) {
  return { mem: [], facts: [], f: 30, quest: null, giftDay: -1, disc: null, met: 0, first: day, last: -1, done: 0 };
}
// A record as stored or sent (from a save, a client, the server): checked and trimmed.
export function cleanRecord(r, day = 0) {
  const out = newRecord(day);
  if (!r || typeof r !== 'object') return out;
  if (Array.isArray(r.mem)) out.mem = r.mem.filter((e) => Array.isArray(e)).slice(-MAX_MEM).map(([a, b]) => [clip(a, 120), clip(b, 160)]);
  if (Array.isArray(r.facts)) out.facts = r.facts.slice(-MAX_FACTS).map((s) => clip(s, 80)).filter(Boolean);
  if (Number.isFinite(r.f)) out.f = clamp(Math.round(r.f), 0, 100);
  if (r.quest && typeof r.quest === 'object') out.quest = cleanQuest(r.quest);
  for (const k of ['giftDay', 'met', 'first', 'last', 'done']) if (Number.isInteger(r[k])) out[k] = r[k];
  if (r.disc && Number.isInteger(r.disc.pct) && Number.isInteger(r.disc.day)) out.disc = { pct: clamp(r.disc.pct, 5, 30), day: r.disc.day };
  return out;
}
function cleanQuest(q) {
  if (!stuffId(q.want) || !REWARDS[q.reward]) return null;
  return { want: q.want, count: clamp(q.count | 0, 1, 64), reward: q.reward, rewardCount: clamp(q.rewardCount | 0, 1, REWARDS[q.reward]), day: q.day | 0 };
}

// What was said, and what happened (a note, in the villager's own words), goes into the record.
export function remember(rec, { line = '', reply = '', note = '', day = 0 } = {}) {
  if (line || reply) {
    rec.mem.push([clip(line, 120), clip(reply, 160)]);
    while (rec.mem.length > MAX_MEM) rec.mem.shift();
  }
  if (note) {
    rec.facts.push(clip(note, 80));
    while (rec.facts.length > MAX_FACTS) rec.facts.shift();
  }
  if (line) { if (rec.last !== day || rec.met === 0) rec.met++; rec.last = day; }
  return rec;
}
export function befriend(rec, amount) { rec.f = clamp(Math.round(rec.f + amount), 0, 100); return rec; }
export const hearts = (rec) => Math.round(clamp(rec ? rec.f : 30, 0, 100) / 20); // 0..5

// The discount a villager gives this player today (0 if none).
export function discountToday(rec, day) {
  return rec && rec.disc && rec.disc.day === day ? rec.disc.pct : 0;
}
// A trade's cost with that discount: emeralds come down, nothing drops below one.
export function discounted(cost, pct) {
  if (!pct) return cost;
  return cost.map(([id, n]) => [id, id === ITEM.EMERALD ? Math.max(1, Math.ceil(n * (1 - pct / 100))) : n]);
}

// ---------------------------------------------------------------- the village's gossip
// A rumour: { k: what happened, who, s: detail, day }
export const RUMOR_KINDS = ['death', 'nether', 'end', 'dragon', 'wither', 'join', 'space', 'moon', 'mars', 'jupiter', 'saturn', 'quest', 'gift', 'hit', 'talk'];
export function cleanRumor(r) {
  if (!r || !RUMOR_KINDS.includes(r.k)) return null;
  return { k: r.k, who: clip(r.who, 16), s: clip(r.s, 40), day: r.day | 0 };
}
const DEATH_ZH = { zombie: '被僵尸打败了', skeleton: '被骷髅射中了', creeper: '被苦力怕炸飞了', fall: '从高处摔了下来', lava: '掉进了岩浆', drown: '差点淹死', spider: '被蜘蛛咬了', fire: '被火烧着了', wall: '飞着鞘翅撞到了墙上', starve: '饿晕了' };
const DEATH_EN = { zombie: 'was beaten by a zombie', skeleton: 'was shot by a skeleton', creeper: 'got blown up by a creeper', fall: 'fell from a great height', lava: 'fell into lava', drown: 'nearly drowned', spider: 'was bitten by a spider', fire: 'got burned', wall: 'flew into a wall on elytra', starve: 'fainted from hunger' };
export function rumorText(r, lang, today = 0) {
  const zh = lang === 'zh';
  const ago = today - (r.day | 0);
  const when = zh ? (ago <= 0 ? '今天' : ago === 1 ? '昨天' : ago < 7 ? `${ago}天前` : '前些日子') : (ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : ago < 7 ? `${ago} days ago` : 'a while back');
  const who = r.who || (zh ? '有个人' : 'someone');
  switch (r.k) {
    case 'death': return zh ? `${who}${when}${DEATH_ZH[r.s] || '出了点意外'}` : `${who} ${DEATH_EN[r.s] || 'had an accident'} ${when}`;
    case 'nether': return zh ? `${who}${when}跑到下界去了` : `${who} went to the Nether ${when}`;
    case 'end': return zh ? `${who}${when}去了末地` : `${who} went to the End ${when}`;
    case 'dragon': return zh ? `${who}${when}打败了末影龙！` : `${who} slew the ender dragon ${when}!`;
    case 'wither': return zh ? `${when}有人召唤出了凋灵，太吓人了` : `someone summoned the Wither ${when}, how frightening`;
    case 'join': return zh ? `${when}村子附近来了个新人，叫${who}` : `a newcomer called ${who} turned up ${when}`;
    case 'space': return zh ? `${who}${when}飞上了天，一直飞到了星星那里` : `${who} flew up into the sky ${when}, right up to the stars`;
    case 'moon': return zh ? `${who}${when}去了月亮上！` : `${who} went to the moon ${when}!`;
    case 'mars': return zh ? `${who}${when}去了一颗红色的星星` : `${who} went to a red star ${when}`;
    case 'jupiter': return zh ? `${who}${when}去了一颗有花纹的大星星，住在云彩上面的房子里` : `${who} went to a great striped star ${when}, to a house floating on its clouds`;
    case 'saturn': return zh ? `${who}${when}去了一颗戴着光环的星星` : `${who} went to a star with rings round it ${when}`;
    case 'quest': return zh ? `${who}${when}帮${r.s}干了活` : `${who} helped ${r.s} ${when}`;
    case 'gift': return zh ? `${who}${when}给${r.s}送了礼物` : `${who} gave ${r.s} a present ${when}`;
    case 'hit': return zh ? `${who}${when}打了${r.s}，真没礼貌` : `${who} hit ${r.s} ${when}, how rude`;
    case 'talk': return zh ? `${who}${when}说：“${r.s}”` : `${who} said "${r.s}" ${when}`;
    default: return '';
  }
}

// ---------------------------------------------------------------- the model's prompt
// input: { persona, lang, playerName, line, rec, ctx, neighbors: [{ name, job }], rumors, note, day }
// ctx: { time, weather, biome, held, armor, hp, food, danger, dim, mode }
export function buildMessages(input) {
  const { persona: p, lang, playerName = '', line = '', note = '' } = input;
  const rec = input.rec || newRecord();
  const ctx = input.ctx || {};
  const zh = lang === 'zh';
  const job = JOBS[p.job] || JOBS.none;
  const traits = p.traits.map((k) => TRAITS[k][zh ? 0 : 1]).join(zh ? '、' : ', ');
  const quirk = QUIRKS[p.quirk % QUIRKS.length][zh ? 0 : 1];
  const day = input.day | 0;
  const wants = (WANTS[p.job] || WANTS.none).map(([k]) => `${k}(${stuffName(k, lang)})`).join(', ');
  const rewards = Object.keys(REWARDS).map((k) => `${k}(${stuffName(k, lang)})≤${REWARDS[k]}`).join(', ');
  const gifts = Object.keys(GIFTS).map((k) => `${k}(${stuffName(k, lang)})`).join(', ');
  const neighbors = (input.neighbors || []).slice(0, 6).map((n) => `${clip(n.name, 12)}（${jobName(n.job, lang)}）`).join(zh ? '、' : ', ');
  const rumors = (input.rumors || []).slice(-6).map((r) => rumorText(r, lang, day)).filter(Boolean);
  const facts = rec.facts.slice(-MAX_FACTS);
  const who = clip(playerName, 16) || (zh ? '这位玩家' : 'this player');
  const f = rec.f;
  const mood = f < 15 ? (zh ? '你不太喜欢这个人，说话冷淡些' : 'you do not much like them; be cool with them') : f < 50 ? (zh ? '一般' : 'neutral') : f < 80 ? (zh ? '你挺喜欢这个人' : 'you like them') : (zh ? '你们是好朋友' : 'you are good friends');
  const q = rec.quest;
  const quest = q ? (zh ? `你请${who}帮忙找${q.count}个${stuffName(q.want, lang)}，答应给${q.rewardCount}个${stuffName(q.reward, lang)}（还没完成）。` : `You asked ${who} for ${q.count} ${stuffName(q.want, lang)} and promised ${q.rewardCount} ${stuffName(q.reward, lang)} (not done yet).`) : (zh ? '目前没有请对方帮忙。' : 'You have not asked them for anything at the moment.');
  const looks = [];
  if (ctx.held) looks.push(zh ? `手里拿着${stuffName(ctx.held, lang)}` : `holding ${stuffName(ctx.held, lang)}`);
  if (ctx.armor) looks.push(zh ? `穿着${ctx.armor}盔甲` : `wearing ${ctx.armor} armour`);
  if (Number.isFinite(ctx.hp) && ctx.hp < 8) looks.push(zh ? '看起来受了伤' : 'looking hurt');
  if (Number.isFinite(ctx.food) && ctx.food < 6) looks.push(zh ? '肚子饿得咕咕叫' : 'looking hungry');
  const danger = ctx.danger > 0 ? (zh ? `附近有${ctx.danger}个怪物在游荡，你有点紧张。` : `There are ${ctx.danger} monsters about; you are a little nervous.`) : '';
  const lines = zh ? [
    '你在扮演《光影方块世界》（一个和《我的世界》很像的方块游戏）里的一个村民。用第一人称、口语化的中文说话，像真人聊天一样。',
    `你是谁：${p.full.zh}${p.name.zh !== p.full.zh ? `，大家叫你“${p.name.zh}”` : ''}，${p.gender === 'male' ? '男' : '女'}，${{ young: '年轻人', middle: '中年人', old: '老人' }[p.age]}，职业是${job[0]}（${job[2]}）。性格：${traits}。你${quirk}。口头禅是“${catchOf(p, 'zh')}”（偶尔用，别每句都用）。`,
    `你住的村子在${clip(ctx.biome || '平原', 12)}。现在是第${day + 1}天的${clip(ctx.time || '白天', 8)}，${clip(ctx.weather || '天气不错', 12)}。${danger}`,
    neighbors ? `村里的邻居有：${neighbors}。` : '',
    rumors.length ? `最近村里流传的事：${rumors.join('；')}。` : '',
    `你和${who}：${rec.met ? `见过${rec.met}回了` : '这是第一次见面'}，好感度${f}/100（${mood}）。${facts.length ? '你记得：' + facts.join('；') + '。' : ''}`,
    quest,
    looks.length ? `${who}现在${looks.join('，')}。` : '',
    '',
    '说话规则：',
    '- 每次回复一到三句话，最多60个字；不要列表，不要markdown。',
    '- 你只知道这个方块世界里的事（种地、挖矿、怪物、下界、末地、村子里的人……）。手机、电脑、城市、名人这些现实世界的东西你从没听说过，就用村民的方式好奇或困惑地回应。',
    '- 内容要适合小朋友：不说脏话，不讲血腥恐怖的细节。有人让你说不好的话，就按你的性格婉拒。',
    '- 不要说自己是AI、模型或程序，你就是这个村民。不要替玩家说话。',
    '- 你可以做这几件事（只在合适的时候做，一次最多一件）：',
    `  1. 请玩家帮忙找东西（任务）。要的东西只能从这些里挑：${wants}；奖励只能从这些里挑（≤后面是最多给几个）：${rewards}。已经有任务没完成时不要再派新任务。`,
    `  2. 送个小礼物，只在关系好（好感度50以上）而且今天还没送过的时候：${gifts}。`,
    '  3. 对方讲价、说好话打动了你，就打折（5到30）。',
    '  4. 对方请你跟着他走的时候，跟着走一会儿（15到120秒）；请你别跟了，就停下（秒数写0）。',
    '回复格式：只输出一个JSON对象，不要任何别的文字：',
    '{"say":"你说的话","mood":"happy|sad|angry|scared|surprised|neutral","action":null}',
    'action可以是：{"type":"quest","want":"wheat","count":10,"reward":"emerald","rewardCount":3}、{"type":"gift","item":"bread","count":2}、{"type":"discount","pct":10}、{"type":"follow","seconds":60}。物品用括号前面的英文名。',
  ] : [
    'You are playing a villager in Lumencraft, a block game much like Minecraft. Speak in the first person, casually, like a real person chatting, in English.',
    `Who you are: ${p.full.en}${p.name.en !== p.full.en ? `, known as "${p.name.en}"` : ''}, ${p.gender}, ${{ young: 'young', middle: 'middle-aged', old: 'old' }[p.age]}, the village ${job[1]} (${job[3]}). Character: ${traits}. You ${quirk}. Your pet phrase is "${catchOf(p, 'en')}" (now and then, not every time).`,
    `Your village is in a ${clip(ctx.biome || 'plains', 16)}. It is the ${clip(ctx.time || 'daytime', 12)} of day ${day + 1}, ${clip(ctx.weather || 'fair weather', 16)}. ${danger}`,
    neighbors ? `Your neighbours: ${neighbors}.` : '',
    rumors.length ? `Village gossip lately: ${rumors.join('; ')}.` : '',
    `You and ${who}: ${rec.met ? `you have met ${rec.met} times` : 'this is your first meeting'}, friendship ${f}/100 (${mood}). ${facts.length ? 'You remember: ' + facts.join('; ') + '.' : ''}`,
    quest,
    looks.length ? `${who} is ${looks.join(', ')}.` : '',
    '',
    'Rules:',
    '- Reply in one to three short sentences (at most 40 words); no lists, no markdown.',
    '- You only know this block world (farming, mining, monsters, the Nether, the End, the village folk). Phones, computers, cities and famous people mean nothing to you: react with a villager\'s puzzled curiosity.',
    '- Keep it suitable for children: no swearing, no gory or scary detail. If asked to say something nasty, turn it down in character.',
    '- Never say you are an AI, a model or a program: you are this villager. Never speak for the player.',
    '- You may do one of these when it fits (at most one per reply):',
    `  1. Ask the player for a hand (a task). Wanted items only from: ${wants}; rewards only from these (at most the number after ≤): ${rewards}. No new task while one is unfinished.`,
    `  2. Give a small present, only to a friend (friendship 50+) and not twice in a day: ${gifts}.`,
    '  3. Knock something off your prices (5 to 30 percent) when haggled with or charmed.',
    '  4. Follow the player for a while (15 to 120 seconds) when asked; when asked to stop, stop (seconds 0).',
    'Answer format: output one JSON object and nothing else:',
    '{"say":"what you say","mood":"happy|sad|angry|scared|surprised|neutral","action":null}',
    'action may be: {"type":"quest","want":"wheat","count":10,"reward":"emerald","rewardCount":3}, {"type":"gift","item":"bread","count":2}, {"type":"discount","pct":10}, {"type":"follow","seconds":60}. Use the item names before the brackets.',
  ];
  const messages = [{ role: 'system', content: lines.filter((s) => s !== '').join('\n') }];
  for (const [a, b] of rec.mem.slice(-MAX_MEM)) {
    if (a) messages.push({ role: 'user', content: `${who}：${a}` });
    if (b) messages.push({ role: 'assistant', content: JSON.stringify({ say: b, mood: 'neutral', action: null }) });
  }
  const said = clip(line, 200);
  const happened = note ? (zh ? `（${clip(note, 80)}）` : `(${clip(note, 80)})`) : '';
  messages.push({ role: 'user', content: `${who}：${happened}${said || (happened ? '' : zh ? '（走到你面前，看着你）' : '(walks up to you and looks at you)')}` });
  return messages;
}

// The model's answer: { say, mood, action } (what it said even when it forgot the JSON).
export function parseReply(text) {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try {
      const o = JSON.parse(s.slice(i, j + 1));
      if (o && typeof o.say === 'string') {
        return { say: clip(o.say, 160) || '……', mood: MOODS.includes(o.mood) ? o.mood : 'neutral', action: o.action && typeof o.action === 'object' ? o.action : null };
      }
    } catch (e) { /* not JSON after all */ }
  }
  const plain = s.replace(/\{[\s\S]*\}/g, '').replace(/^["“]|["”]$/g, '').trim();
  return { say: clip(plain, 160) || '……', mood: 'neutral', action: null };
}

// Something a villager wants to do, checked against what it may do. state: { job, rec, day }.
// Returns the action as it will be carried out, or null.
export function cleanAction(a, { job = 'none', rec = null, day = 0 } = {}) {
  if (!a || typeof a !== 'object') return null;
  const f = rec ? rec.f : 30;
  switch (a.type) {
    case 'quest': {
      if (rec && rec.quest) return null;
      const list = WANTS[job] || WANTS.none;
      const w = list.find((x) => x[0] === a.want) || (allWants().includes(a.want) ? [a.want, 1, 16] : null);
      if (!w || !stuffId(w[0])) return null;
      const reward = REWARDS[a.reward] ? a.reward : 'emerald';
      const count = clamp(Number.isFinite(a.count) ? Math.round(a.count) : w[1], 1, Math.max(w[2], 1));
      const rewardCount = clamp(Number.isFinite(a.rewardCount) ? Math.round(a.rewardCount) : 1, 1, REWARDS[reward]);
      return { type: 'quest', want: w[0], count, reward, rewardCount, day };
    }
    case 'gift': {
      if (f < 50 || (rec && rec.giftDay === day)) return null;
      const max = GIFTS[a.item];
      if (!max || !stuffId(a.item)) return null;
      return { type: 'gift', item: a.item, count: clamp(Number.isFinite(a.count) ? Math.round(a.count) : 1, 1, max) };
    }
    case 'discount': {
      if (rec && rec.disc && rec.disc.day === day) return null;
      const pct = clamp(Math.round((Number(a.pct) || 10) / 5) * 5, 5, f < 20 ? 10 : 30);
      return { type: 'discount', pct, day };
    }
    case 'follow':
      return { type: 'follow', seconds: clamp(Math.round(Number(a.seconds) || 0), 0, 120) };
    default: return null;
  }
}

// Carry out on the record what was agreed (the items themselves are the game's business).
export function applyAction(rec, a, day = 0) {
  if (!a) return rec;
  if (a.type === 'quest') rec.quest = { want: a.want, count: a.count, reward: a.reward, rewardCount: a.rewardCount, day };
  else if (a.type === 'gift') rec.giftDay = day;
  else if (a.type === 'discount') rec.disc = { pct: a.pct, day };
  return rec;
}

// ---------------------------------------------------------------- without a model
const INTENTS = [
  ['bye', /再见|拜拜|回见|下次见|我走了|\bbye\b|see you|goodbye|good night/i],
  ['thanks', /谢谢|多谢|感谢|谢啦|thank/i],
  ['stop', /别跟|不用跟|停下|别走了|回去吧|stop following|go home|stay here|stop/i],
  ['follow', /跟我|跟着我|一起走|过来|带你|follow|come with|come here/i],
  ['quest', /任务|帮忙|帮你|需要什么|要什么|有活|干活|活儿|quest|task|help you|need anything|any work|job for me/i],
  ['gift', /送我|给我|礼物|免费|白送|gift|present|free|give me/i],
  ['discount', /便宜|打折|优惠|讲价|太贵|贵了|discount|cheaper|price|too expensive|deal/i],
  ['news', /新鲜事|八卦|听说|消息|最近|有什么事|发生了什么|news|gossip|rumou?r|heard|what'?s new/i],
  ['name', /你叫|名字|你是谁|怎么称呼|who are you|your name/i],
  ['job', /职业|工作|做什么|干什么|干啥|忙什么|what do you do|your job|work/i],
  ['ai', /机器人|\bai\b|人工智能|chatgpt|模型|程序|robot|are you real/i],
  ['real', /手机|电脑|网络|城市|学校|汽车|飞机|电视|上网|游戏机|phone|computer|internet|school|\bcar\b|plane|\btv\b/i],
  ['space', /太空|宇宙|月亮|月球|火星|星星|外星|space|moon|mars|stars|alien|planet/i],
  ['nether', /下界|地狱|nether|hell/i],
  ['end', /末地|末影龙|ender|\bend\b|dragon/i],
  ['danger', /怪物|僵尸|苦力怕|骷髅|蜘蛛|危险|害怕|monster|zombie|creeper|skeleton|spider|danger|scared/i],
  ['weather', /天气|下雨|下雪|晴天|weather|rain|snow|sunny/i],
  ['story', /故事|讲讲|讲个|笑话|story|joke|tell me/i],
  ['praise', /厉害|真棒|好看|喜欢你|你真好|可爱|nice|great|cool|love you|awesome|cute|kind/i],
  ['insult', /笨|蠢|傻|讨厌你|滚|丑|坏蛋|stupid|idiot|dumb|hate you|ugly|go away/i],
  ['greet', /你好|您好|嗨|哈喽|早上好|晚上好|下午好|早啊|喂|\bhi\b|hello|\bhey\b|good (morning|evening|afternoon)|howdy/i],
];
export function intentOf(line) {
  const s = String(line || '');
  for (const [k, re] of INTENTS) if (re.test(s)) return k;
  return s.trim() ? 'other' : 'greet';
}

const L = {
  zh: {
    first: ['哟，新面孔！我是{name}，村里的{job}。你叫{player}吧？', '{catch}，你好你好！我叫{name}，是这儿的{job}。', '欢迎来我们村！我是{name}，有事尽管找我。'],
    greet: ['{player}来啦！{weatherLine}', '哟，{player}！今天过得咋样？', '{catch}，是{player}啊，又见面了！', '{player}，好久不见……其实也没多久，嘿嘿。'],
    greetNight: ['这么晚了还在外面晃？{player}，小心僵尸！', '天都黑了，{player}，快进屋吧。'],
    cold: ['哼，又是你。', '……你想干嘛？', '我还记着你上回干的事呢。'],
    name: ['我叫{full}，大家都叫我{name}。', '{name}！全村都认识我。'],
    nameSame: ['我叫{full}。', '{full}！全村都认识我。'],
    job: ['我是{job}，{jobDesc}。', '干{job}这一行好些年了，{jobDesc}。'],
    questHave: ['上回说的{count}个{want}找到了吗？找齐了就点「交付」。', '我还等着你的{want}呢，{count}个，别忘啦！'],
    questNew: ['正好！帮我找{count}个{want}吧，我给你{rewardCount}个{reward}。', '{catch}，你来得巧。我缺{count}个{want}，找来了给你{rewardCount}个{reward}，咋样？'],
    giftYes: ['拿着吧，一点{item}，自家的。', '看你人不错，这{count}个{item}送你了！'],
    giftNo: ['哈哈，想得美！先帮我干点活再说。', '今天已经送过啦，明天再来吧。', '我可不是开善堂的，嘿嘿。'],
    discYes: ['行吧行吧，看你顺眼，便宜{pct}%！', '{catch}，就你嘴甜，打个{pctTen}折。'],
    discNo: ['一分钱一分货，不能再便宜了。', '今天已经给你便宜过了，再便宜我就亏啦。'],
    newsSome: ['听说{rumor}。', '你知道吗？{rumor}！', '{catch}，我跟你说，{rumor}。'],
    newsNone: ['最近村里挺太平的，就是我{quirk}。', '没啥新鲜事，就是麦子长得挺好。', '能有啥事，天天还不都一样嘛。'],
    danger: ['晚上僵尸多，记得早点回屋，门要关好！', '苦力怕最吓人了，听到“嘶嘶”声就快跑！', '骷髅会射箭，躲在树后面就打不着你。'],
    dangerNow: ['你看那边！好像有怪物，快保护我！', '我、我有点怕……附近有怪物在转悠。'],
    weatherClear: '今天天气真好，适合干活。', weatherRain: '又下雨了，真是的。', weatherStorm: '打雷了！可别站在树底下。', weatherSnow: '下雪了，冷得我直哆嗦。',
    story: ['从前有个矿工挖呀挖，挖到了钻石，结果一高兴掉进了岩浆……所以挖矿千万别往脚下挖！', '我爷爷说，很久以前有条大龙，住在一个全是黑石头的地方，谁也打不过它。', '有一回我在河边钓到一只靴子，你说气人不气人？', '据说月亮上也有方块，就是没人去过。'],
    joke: ['为什么苦力怕没有朋友？因为它一激动就“炸”了，哈哈！', '僵尸为啥白天不出门？怕晒黑呀！'],
    follow: ['好嘞，我跟着你！别走太快啊。', '走，带路吧！'],
    stop: ['那我回去了，有事再叫我。', '好，我就在这儿待着。'],
    thanks: ['不客气！', '应该的应该的。', '嘿嘿，有空常来。'],
    bye: ['慢走啊，常来玩！', '回见！路上小心怪物。', '再见，{player}！'],
    praise: ['哎呀，你这么说我都不好意思了。', '嘿嘿，你也很厉害！', '真的吗？我就知道！'],
    insult: ['你怎么说话的！哼。', '我不跟你一般见识。', '……我生气了。'],
    ai: ['啥是AI？我就是个普普通通的{job}啊。', '机器人？没听说过，你说的是铁傀儡吗？'],
    real: ['“{word}”？那是啥？能吃吗？', '你说的东西我从来没见过，是在很远很远的地方吗？'],
    space: ['我{quirkSpace}！听说一直往天上飞，就能飞到星星那里。', '月亮上会不会也有村子呢？真想去看看。', '天上那颗红色的星星，我每晚都盯着看。'],
    nether: ['下界？听说那里到处是岩浆，还有会飞的大白鬼！', '黑曜石搭个门框，再点上火，就能去下界……我可不敢。'],
    end: ['末地？那是传说里的地方，有一条大黑龙！', '听说用末影之眼能找到去末地的路。'],
    other: ['嗯……这个我不太懂。要不你问问图书管理员？', '“{short}”？哈哈，你这人真有意思。', '{catch}，你说的我没太明白。', '哦哦，是这样啊。', '这事儿嘛……我得想想。'],
    baby: ['嘻嘻！', '你好呀！', '陪我玩捉迷藏吧！'],
    hit: ['哎哟！你干嘛打我！', '救命啊！铁傀儡快来！', '你、你这人怎么这样！'],
    gotGift: ['哇，这是送给我的？太谢谢你了！', '{item}！我正需要这个，谢谢你！', '你真是个好人，{player}！'],
    gotGiftMeh: ['呃……{item}？好吧，心意我领了。', '谢谢……虽然我不太用得上{item}。'],
    deliver: ['太好了，{count}个{want}都齐了！这是答应你的{rewardCount}个{reward}。', '真靠谱！拿着，{rewardCount}个{reward}。下回还找你！'],
    trade: ['谢谢惠顾！', '成交！下次再来。'],
  },
  en: {
    first: ['A new face! I\'m {name}, the village {job}. And you must be {player}?', '{catch}, hello there! Name\'s {name}, I\'m the {job} here.', 'Welcome to our village! I\'m {name}, just ask if you need anything.'],
    greet: ['{player}! {weatherLine}', 'Oh, {player}! How\'s your day going?', '{catch}, it\'s {player} again!', 'Long time no see, {player}... well, not that long.'],
    greetNight: ['Out this late, {player}? Mind the zombies!', 'It\'s dark already, {player}. Get indoors!'],
    cold: ['Hmph. You again.', '...What do you want?', 'I haven\'t forgotten what you did.'],
    name: ['I\'m {full}, but everyone calls me {name}.', '{name}! The whole village knows me.'],
    nameSame: ['I\'m {full}.', '{full}! The whole village knows me.'],
    job: ['I\'m the {job}. I {jobDesc}.', 'Been the {job} for years now. I {jobDesc}.'],
    questHave: ['Found those {count} {want} yet? Press "Hand over" when you have them.', 'Still waiting on my {want}, {count} of them. Don\'t forget!'],
    questNew: ['Perfect timing! Bring me {count} {want} and I\'ll give you {rewardCount} {reward}.', '{catch}, I could use {count} {want}. {rewardCount} {reward} for your trouble?'],
    giftYes: ['Here, take some {item}. Home-made.', 'You\'re all right, you are. Have {count} {item}!'],
    giftNo: ['Ha, nice try! Do me a favour first.', 'I gave you something today already. Come back tomorrow.', 'I\'m not a charity, you know!'],
    discYes: ['Oh, go on then, {pct}% off for you.', '{catch}, such a charmer. {pct}% off!'],
    discNo: ['You get what you pay for. That\'s my price.', 'You had a discount today already!'],
    newsSome: ['I heard {rumor}.', 'Did you know? {rumor}!', '{catch}, word is {rumor}.'],
    newsNone: ['All quiet in the village. Mind you, I {quirk}.', 'Nothing new. The wheat\'s coming up nicely though.', 'Same as ever round here.'],
    danger: ['Zombies come out at night. Get in early and shut the door!', 'Creepers are the worst. If you hear hissing, run!', 'Skeletons shoot arrows. Hide behind a tree.'],
    dangerNow: ['Look over there! Monsters! Protect me!', 'I-I\'m a bit scared... there are monsters about.'],
    weatherClear: 'Lovely weather for working.', weatherRain: 'Raining again, honestly.', weatherStorm: 'Thunder! Don\'t stand under a tree.', weatherSnow: 'Snow! I\'m shivering.',
    story: ['A miner once dug straight down, found diamonds, and fell into lava from the excitement. Never dig straight down!', 'My grandad said a great dragon lives where the stones are black, and nobody can beat it.', 'I once fished up an old boot. The cheek of it!', 'They say there are blocks on the moon too. Nobody\'s been, though.'],
    joke: ['Why don\'t creepers have friends? They blow up at the slightest thing!', 'Why do zombies stay in during the day? They don\'t want a tan!'],
    follow: ['Right behind you! Not too fast now.', 'Lead the way!'],
    stop: ['I\'ll head back then. Call me if you need me.', 'All right, I\'ll wait here.'],
    thanks: ['You\'re welcome!', 'Any time.', 'Come again soon!'],
    bye: ['Take care, come again!', 'See you! Mind the monsters.', 'Goodbye, {player}!'],
    praise: ['Oh stop it, you\'ll make me blush.', 'You\'re not so bad yourself!', 'Really? I knew it!'],
    insult: ['How rude! Hmph.', 'I won\'t dignify that.', '...Now I\'m cross.'],
    ai: ['An AI? I\'m just a plain old {job}.', 'A robot? Never heard of one. You mean the iron golem?'],
    real: ['A "{word}"? What\'s that, can you eat it?', 'Never seen such a thing. Is it from very far away?'],
    space: ['I {quirkSpace}! They say if you fly up and up you reach the stars.', 'Do you think there are villages on the moon? I\'d love to see.', 'That red star in the sky, I watch it every night.'],
    nether: ['The Nether? Lava everywhere, and great white floating ghosts!', 'An obsidian frame and a spark, and off you go to the Nether... not me, thanks.'],
    end: ['The End? It\'s in the old stories. A great black dragon lives there!', 'They say eyes of ender show the way to the End.'],
    other: ['Hmm... not my area. Ask the librarian?', '"{short}"? Ha, you\'re a funny one.', '{catch}, I didn\'t quite follow.', 'Oh, I see.', 'Well now... let me think about that.'],
    baby: ['Hee hee!', 'Hello!', 'Play hide and seek with me!'],
    hit: ['Ow! What was that for!', 'Help! Iron golem!', 'How could you!'],
    gotGift: ['For me? Thank you so much!', '{item}! Just what I needed, thank you!', 'You\'re a good sort, {player}!'],
    gotGiftMeh: ['Er... {item}? Well, it\'s the thought that counts.', 'Thanks... though I\'m not sure what to do with {item}.'],
    deliver: ['Wonderful, all {count} {want}! Here are the {rewardCount} {reward} I promised.', 'Reliable as anything! {rewardCount} {reward} for you. I\'ll ask you again!'],
    trade: ['Pleasure doing business!', 'Deal! Come again.'],
  },
};

// A reply without a model. input as for buildMessages, plus rnd (default Math.random) and
// event: 'hit' | 'gift' (with item) | 'deliver' | 'trade' for things that happened rather than
// were said.
export function offlineReply(input) {
  const { persona: p, lang, playerName = '', line = '', ctx = {}, rumors = [], event = null } = input;
  const rec = input.rec || newRecord();
  const day = input.day | 0;
  const rnd = input.rnd || Math.random;
  const zh = lang === 'zh';
  const T = L[zh ? 'zh' : 'en'];
  const q = rec.quest;
  const vars = {
    name: personaName(p, lang), full: p.full[zh ? 'zh' : 'en'], job: jobName(p.job, lang), jobDesc: (JOBS[p.job] || JOBS.none)[zh ? 2 : 3],
    player: clip(playerName, 16) || (zh ? '朋友' : 'friend'), catch: catchOf(p, lang), quirk: QUIRKS[p.quirk % QUIRKS.length][zh ? 0 : 1],
    quirkSpace: zh ? '一直想知道天上有什么' : 'have always wondered what\'s up in the sky',
    short: clip(line, 12),
    word: clip((String(line).match(/手机|电脑|网络|城市|学校|汽车|飞机|电视|phone|computer|internet|school|car|plane|tv/i) || [''])[0], 8),
  };
  vars.weatherLine = ctx.weather === 'storm' ? T.weatherStorm : ctx.weather === 'rain' ? T.weatherRain : ctx.weather === 'snow' ? T.weatherSnow : T.weatherClear;
  const say = (list, mood = 'neutral', action = null, extra = {}) => ({ say: clip(fill(Array.isArray(list) ? pick(rnd, list) : list, { ...vars, ...extra }), 160), mood, action });
  if (input.baby) return say(T.baby, 'happy');
  if (event === 'hit') return say(T.hit, 'angry');
  if (event === 'trade') return say(T.trade, 'happy');
  if (event === 'gift') {
    const liked = (WANTS[p.job] || WANTS.none).some((w) => w[0] === input.item) || GIFTS[input.item];
    return say(liked ? T.gotGift : T.gotGiftMeh, liked ? 'happy' : 'neutral', null, { item: stuffName(input.item, lang) });
  }
  if (event === 'deliver' && q) return say(T.deliver, 'happy', null, { count: q.count, want: stuffName(q.want, lang), rewardCount: q.rewardCount, reward: stuffName(q.reward, lang) });
  const intent = intentOf(line);
  const night = ctx.time === (zh ? '晚上' : 'night') || ctx.time === 'night';
  if (rec.f < 15 && intent !== 'bye' && intent !== 'thanks' && rnd() < 0.7) return say(T.cold, 'angry');
  switch (intent) {
    case 'greet':
      if (!rec.met) return say(T.first, 'happy');
      if (ctx.danger > 0) return say(T.dangerNow, 'scared');
      return say(night ? T.greetNight : T.greet, 'happy');
    case 'name': return say(vars.name === vars.full ? T.nameSame : T.name, 'happy');
    case 'job': return say(T.job);
    case 'quest': {
      if (q) return say(T.questHave, 'neutral', null, { count: q.count, want: stuffName(q.want, lang) });
      const list = WANTS[p.job] || WANTS.none;
      const [want, lo, hi] = pick(rnd, list);
      const count = lo + Math.floor(rnd() * (hi - lo + 1));
      const reward = rnd() < 0.75 ? 'emerald' : pick(rnd, ['bread', 'cooked_beef', 'iron_ingot', 'arrow', 'cookie']);
      const rewardCount = clamp(reward === 'emerald' ? 1 + Math.floor(count / 6) : Math.ceil(count / 4), 1, REWARDS[reward]);
      const action = cleanAction({ type: 'quest', want, count, reward, rewardCount }, { job: p.job, rec, day });
      return say(T.questNew, 'happy', action, { count, want: stuffName(want, lang), rewardCount, reward: stuffName(reward, lang) });
    }
    case 'gift': {
      if (rec.f >= 50 && rec.giftDay !== day) {
        const item = pick(rnd, ['bread', 'apple', 'cookie', 'carrot', 'poppy']);
        const action = cleanAction({ type: 'gift', item, count: 1 + Math.floor(rnd() * 2) }, { job: p.job, rec, day });
        if (action) return say(T.giftYes, 'happy', action, { item: stuffName(item, lang), count: action.count });
      }
      return say(T.giftNo);
    }
    case 'discount': {
      if (rec.f >= 25 && !(rec.disc && rec.disc.day === day)) {
        const action = cleanAction({ type: 'discount', pct: rec.f >= 70 ? 20 : 10 }, { job: p.job, rec, day });
        if (action) return say(T.discYes, 'happy', action, { pct: action.pct, pctTen: zh ? String((100 - action.pct) / 10).replace('.0', '') : '' });
      }
      return say(T.discNo);
    }
    case 'news':
      if (rumors.length) return say(T.newsSome, 'surprised', null, { rumor: rumorText(pick(rnd, rumors.slice(-5)), lang, day) });
      return say(T.newsNone);
    case 'danger': return say(ctx.danger > 0 ? T.dangerNow : T.danger, ctx.danger > 0 ? 'scared' : 'neutral');
    case 'weather': return say([vars.weatherLine]);
    case 'story': return say(rnd() < 0.3 ? T.joke : T.story, 'happy');
    case 'follow': return say(T.follow, 'happy', { type: 'follow', seconds: 60 });
    case 'stop': return say(T.stop, 'neutral', { type: 'follow', seconds: 0 });
    case 'thanks': return say(T.thanks, 'happy');
    case 'bye': return say(T.bye, 'happy');
    case 'praise': return say(T.praise, 'happy');
    case 'insult': return say(T.insult, 'angry');
    case 'ai': return say(T.ai, 'surprised');
    case 'real': return say(T.real, 'surprised');
    case 'space': return say(T.space, 'surprised');
    case 'nether': return say(T.nether, 'scared');
    case 'end': return say(T.end, 'surprised');
    default: return say(T.other);
  }
}

// How what was said or done changes a villager's feelings.
export function feelingFor({ line = '', event = null, action = null }) {
  if (event === 'hit') return -12;
  if (event === 'gift') return 4;
  if (event === 'deliver') return 8;
  if (event === 'trade') return 1;
  const i = intentOf(line);
  let d = 1;
  if (i === 'praise' || i === 'thanks') d = 3;
  if (i === 'insult') d = -6;
  if (action && action.type === 'discount') d = 0;
  return d;
}

// ---------------------------------------------------------------- a word in passing
// Said unprompted, to a player walking by.
const AMBIENT = {
  zh: {
    morning: ['早上好！', '早啊！今天也要加油干活。', '一大早的，精神不错嘛！'],
    day: ['今天天气不错。', '嘿，{player}！', '有空来我家坐坐。', '忙着呢忙着呢。', '唉，活儿真多。'],
    evening: ['太阳快下山了，早点回家。', '晚饭吃什么好呢……', '天要黑了，怪物要出来了。'],
    night: ['这么晚还不睡？', '嘘……小声点，大家都睡了。', '外面不安全，快进屋！'],
    rain: ['又下雨了。', '下雨天正好睡大觉。'],
    job: {
      farmer: ['今年的麦子长得真好。', '胡萝卜该收了。'], fisherman: ['今天鱼都不上钩。', '我刚钓到一条大鲑鱼！'],
      librarian: ['这本书我看了三遍了。', '知识就是力量！'], butcher: ['今晚吃烤猪排！'], shepherd: ['我的羊又跑了一只……'],
      armorer: ['好盔甲能救命啊。'], weaponsmith: ['剑要磨得快才好。'], toolsmith: ['工具用坏了要修！'], mason: ['这块石头真漂亮。'],
      cleric: ['愿你平平安安。'], cartographer: ['听说远处有座大府邸……'], fletcher: ['箭头要直，羽毛要齐。'], leatherworker: ['这皮子手感不错。'], nitwit: ['嘿嘿嘿……', '我在想事情。想什么？忘了。'],
    },
  },
  en: {
    morning: ['Good morning!', 'Morning! Another busy day.', 'Bright and early, are we?'],
    day: ['Lovely day.', 'Hello, {player}!', 'Pop round for a visit some time.', 'Busy, busy.', 'So much to do.'],
    evening: ['Sun\'s going down. Head home soon.', 'What shall I have for supper...', 'Getting dark. Monsters soon.'],
    night: ['Not asleep yet?', 'Shh... everyone\'s sleeping.', 'It\'s not safe out here. Get inside!'],
    rain: ['Raining again.', 'Perfect weather for a nap.'],
    job: {
      farmer: ['The wheat\'s doing well this year.', 'Carrots are about ready.'], fisherman: ['Nothing\'s biting today.', 'I just caught a huge salmon!'],
      librarian: ['I\'ve read this book three times.', 'Knowledge is power!'], butcher: ['Roast pork tonight!'], shepherd: ['Another sheep wandered off...'],
      armorer: ['Good armour saves lives.'], weaponsmith: ['A sword must be sharp.'], toolsmith: ['Mend your tools!'], mason: ['What a beautiful stone.'],
      cleric: ['Stay safe, friend.'], cartographer: ['I hear there\'s a great mansion far away...'], fletcher: ['Straight shafts, even feathers.'], leatherworker: ['Fine leather, this.'], nitwit: ['Hee hee...', 'I was thinking. About what? Forgot.'],
    },
  },
};
export function ambientLine({ persona: p, lang, playerName = '', ctx = {}, rnd = Math.random }) {
  const A = AMBIENT[lang === 'zh' ? 'zh' : 'en'];
  let list;
  const r = rnd();
  if (ctx.weather === 'rain' || ctx.weather === 'storm') list = r < 0.5 ? A.rain : A.day;
  else if (ctx.phase === 'night') list = A.night;
  else if (ctx.phase === 'morning') list = r < 0.6 ? A.morning : A.day;
  else if (ctx.phase === 'evening') list = A.evening;
  else list = r < 0.45 && A.job[p.job] ? A.job[p.job] : A.day;
  return clip(fill(pick(rnd, list), { player: clip(playerName, 16) || (lang === 'zh' ? '朋友' : 'friend') }), 80);
}
// Two villagers passing the time of day: [a's line, b's answer]
const PAIRS = {
  zh: [['今天麦子收成咋样？', '还行还行，就是虫子多。'], ['昨晚你听见僵尸叫了吗？', '听见了！吓得我一宿没睡。'], ['你家的猫又跑我家来了。', '哈哈，它就喜欢你家的鱼。'],
    ['听说铁傀儡昨天打跑了三个僵尸！', '真厉害，咱们村就靠它了。'], ['明天会下雨吗？', '看这云，八成要下。'], ['你见过下界吗？', '没有，也不想见。'],
    ['新来的那个人挺勤快的。', '是啊，还帮我修了篱笆。'], ['我新学了一首诗。', '念来听听？……算了，我还要干活。'], ['今晚吃啥？', '烤土豆，管够！'], ['你说月亮上有村子吗？', '有的话，那他们一定很冷。']],
  en: [['How\'s the harvest?', 'Not bad, apart from the bugs.'], ['Hear the zombies last night?', 'I did! Didn\'t sleep a wink.'], ['Your cat\'s in my house again.', 'Ha, it loves your fish.'],
    ['The golem chased off three zombies yesterday!', 'What would we do without it.'], ['Rain tomorrow?', 'Looks like it, with these clouds.'], ['Ever seen the Nether?', 'No, and I don\'t want to.'],
    ['The newcomer works hard.', 'Mended my fence, too.'], ['I learned a new poem.', 'Let\'s hear it... actually, I\'ve work to do.'], ['What\'s for supper?', 'Baked potatoes, plenty of them!'], ['Are there villages on the moon?', 'If there are, they must be cold.']],
};
export function chatterPair(lang, rnd = Math.random) {
  return pick(rnd, PAIRS[lang === 'zh' ? 'zh' : 'en']);
}
