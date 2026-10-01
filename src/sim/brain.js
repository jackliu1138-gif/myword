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
// a sentence without its closing stop (to go inside another)
const bare = (s) => String(s).replace(/[。！!？?．.，,]+$/, '');

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
// a quirk as the villager would say it of itself ('i'), or as told to it ('you'); in English the
// list has them as of someone else ("is terrified of creepers")
export function quirkText(p, lang, person = 'they') {
  const q = QUIRKS[p.quirk % QUIRKS.length][lang === 'zh' ? 0 : 1];
  if (lang === 'zh' || person === 'they') return q;
  const [w, ...rest] = q.split(' ');
  const verb = w === 'is' ? (person === 'i' ? 'am' : 'are') : w === 'has' ? 'have' : w === 'can' ? 'can' : w.replace(/ies$/, 'y').replace(/(ss|sh|ch|x)es$/, '$1').replace(/s$/, '');
  return [verb, ...rest].join(' ');
}
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

// ---------------------------------------------------------------- places worth the trip
// What a villager has heard of round about: the game finds the real places (a kind, which way
// and how far: { k, dir, d }) and a villager may tell of one, as a rumour of treasure.
export const PLACE_KINDS = ['temple', 'hut', 'outpost', 'monument', 'mansion', 'mineshaft', 'village', 'stronghold'];
const PLACES = {
  temple: ['沙漠神殿', 'desert temple'], hut: ['女巫小屋', 'witch hut'], outpost: ['掠夺者前哨站', 'pillager outpost'],
  monument: ['海底神殿', 'ocean monument'], mansion: ['林地府邸', 'woodland mansion'], mineshaft: ['废弃矿井', 'abandoned mineshaft'],
  village: ['另一个村子', 'another village'], stronghold: ['要塞', 'stronghold'],
};
const PLACE_TIPS = {
  zh: {
    temple: '里面好像埋着宝箱，可千万别踩中间那块压力板！', hut: '那儿住着个女巫，会朝人扔药水。', outpost: '那儿驻扎着掠夺者，手里拿着弩，可别一个人去。',
    monument: '在深深的海底，有守卫者看着，得带上水下呼吸药水。', mansion: '里面全是卫道士和唤魔者，凶得很，不过听说藏着好东西。',
    mineshaft: '地底下全是铁轨和宝箱，还有蜘蛛，火把要带够！', village: '那边的人烤的面包可香了，你去了替我问个好。', stronghold: '老人们说，那底下有一扇通往末地的门。',
  },
  en: {
    temple: 'They say there\'s treasure buried inside. Don\'t step on the pressure plate in the middle!', hut: 'A witch lives there, and she throws potions at people.',
    outpost: 'Pillagers camp there with crossbows. Don\'t go alone.', monument: 'It\'s deep under the sea, with guardians. Take a potion of water breathing.',
    mansion: 'It\'s full of vindicators and evokers, nasty lot, but they say there\'s treasure.', mineshaft: 'Rails and chests all through it, and spiders. Take plenty of torches!',
    village: 'They bake lovely bread over there. Say hello from me.', stronghold: 'The old folk say there\'s a door to the End down there.',
  },
};
export const DIRS8 = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const DIR_NAMES = { n: ['北边', 'north'], ne: ['东北边', 'north-east'], e: ['东边', 'east'], se: ['东南边', 'south-east'], s: ['南边', 'south'], sw: ['西南边', 'south-west'], w: ['西边', 'west'], nw: ['西北边', 'north-west'] };
export const placeName = (k, lang) => (PLACES[k] || PLACES.village)[lang === 'zh' ? 0 : 1];
export const dirName = (d, lang) => (DIR_NAMES[d] || DIR_NAMES.n)[lang === 'zh' ? 0 : 1];
// the way along (dx, dz) as a point of the compass (north is -Z, east +X)
export function compass(dx, dz) {
  const a = Math.atan2(dx, -dz);
  return DIRS8[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
// places as a game sends them: checked, one of each kind, distances rounded to ten blocks
export function cleanPlaces(l) {
  if (!Array.isArray(l)) return [];
  const out = [];
  for (const p of l.slice(0, 8)) {
    if (!p || !PLACE_KINDS.includes(p.k) || !DIRS8.includes(p.dir) || !Number.isFinite(p.d) || out.some((q) => q.k === p.k)) continue;
    out.push({ k: p.k, dir: p.dir, d: clamp(Math.round(p.d / 10) * 10, 10, 5000) });
    if (out.length >= 5) break;
  }
  return out;
}
// "沙漠神殿在东北边，大约350格远" / "a desert temple to the north-east, about 350 blocks away"
export function placeLine(p, lang) {
  if (lang === 'zh') return `${placeName(p.k, 'zh')}在${dirName(p.dir, 'zh')}，大约${p.d}格远`;
  const name = placeName(p.k, 'en');
  return `${p.k === 'village' ? '' : /^[aeiou]/.test(name) ? 'an ' : 'a '}${name} to the ${dirName(p.dir, 'en')}, about ${p.d} blocks away`;
}
export const placeTip = (k, lang) => PLACE_TIPS[lang === 'zh' ? 'zh' : 'en'][k] || '';

// the time of day and the weather in words (the game sends them as keys)
const PHASE_WORDS = { morning: ['早上', 'morning'], day: ['白天', 'daytime'], evening: ['傍晚', 'evening'], night: ['晚上', 'night'] };
const WEATHER_WORDS = { clear: ['天气晴朗', 'fair weather'], rain: ['正在下雨', 'raining'], snow: ['正在下雪', 'snowing'], storm: ['电闪雷鸣', 'a thunderstorm'] };
const phaseWords = (ctx, zh) => (PHASE_WORDS[ctx.phase] || [ctx.time || '白天', ctx.time || 'daytime'])[zh ? 0 : 1];
const weatherWords = (ctx, zh) => (WEATHER_WORDS[ctx.weather] || [ctx.weather || '天气不错', ctx.weather || 'fair weather'])[zh ? 0 : 1];

// hostile creatures a player may see off in a village, by name
const FOES = {
  zombie: ['僵尸', 'a zombie'], husk: ['尸壳', 'a husk'], drowned: ['溺尸', 'a drowned'], skeleton: ['骷髅', 'a skeleton'], stray: ['流浪者', 'a stray'],
  creeper: ['苦力怕', 'a creeper'], spider: ['蜘蛛', 'a spider'], cave_spider: ['洞穴蜘蛛', 'a cave spider'], witch: ['女巫', 'a witch'], slime: ['史莱姆', 'a slime'],
  pillager: ['掠夺者', 'a pillager'], vindicator: ['卫道士', 'a vindicator'], evoker: ['唤魔者', 'an evoker'], ravager: ['劫掠兽', 'a ravager'],
  phantom: ['幻翼', 'a phantom'], enderman: ['末影人', 'an enderman'], silverfish: ['蠹虫', 'a silverfish'],
};
export const foeName = (k, lang) => (FOES[k] ? FOES[k][lang === 'zh' ? 0 : 1] : lang === 'zh' ? '怪物' : 'a monster');

// ---------------------------------------------------------------- the village's gossip
// A rumour: { k: what happened, who, s: detail, day }
export const RUMOR_KINDS = ['death', 'nether', 'end', 'dragon', 'wither', 'join', 'space', 'moon', 'mars', 'jupiter', 'saturn', 'quest', 'gift', 'hit', 'talk', 'hero', 'found'];
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
    case 'hero': return zh ? `${who}${when}在村子里打跑了${foeName(r.s, 'zh')}，大家都在夸` : `${who} saw off ${foeName(r.s, 'en')} in the village ${when}, and everyone's talking about it`;
    case 'found': return zh ? `${who}${when}找到了${PLACES[r.s] ? placeName(r.s, 'zh') : '一个神秘的地方'}` : `${who} found ${!PLACES[r.s] ? 'a mysterious place' : r.s === 'village' ? 'another village' : 'the ' + placeName(r.s, 'en')} ${when}`;
    default: return '';
  }
}

// ---------------------------------------------------------------- the model's prompt
// input: { persona, lang, playerName, line, rec, ctx, neighbors: [{ name, job }], rumors, note, day }
// ctx: { phase, weather, biome, held, armor, hp, food, danger, places: [{ k, dir, d }] }
export function buildMessages(input) {
  const { persona: p, lang, playerName = '', line = '', note = '' } = input;
  const rec = input.rec || newRecord();
  const ctx = input.ctx || {};
  const zh = lang === 'zh';
  const job = JOBS[p.job] || JOBS.none;
  const traits = p.traits.map((k) => TRAITS[k][zh ? 0 : 1]).join(zh ? '、' : ', ');
  const quirk = quirkText(p, lang, 'you');
  const day = input.day | 0;
  const wants = (WANTS[p.job] || WANTS.none).map(([k]) => `${k}(${stuffName(k, lang)})`).join(', ');
  const rewards = Object.keys(REWARDS).map((k) => `${k}(${stuffName(k, lang)})≤${REWARDS[k]}`).join(', ');
  const gifts = Object.keys(GIFTS).map((k) => `${k}(${stuffName(k, lang)})`).join(', ');
  const neighbors = (input.neighbors || []).slice(0, 6).map((n) => `${clip(n.name, 12)}（${jobName(n.job, lang)}）`).join(zh ? '、' : ', ');
  const rumors = (input.rumors || []).slice(-6).map((r) => rumorText(r, lang, day)).filter(Boolean);
  const places = cleanPlaces(ctx.places);
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
    `你住的村子在${clip(ctx.biome || '平原', 12)}。现在是第${day + 1}天的${phaseWords(ctx, true)}，${weatherWords(ctx, true)}。${danger}`,
    neighbors ? `村里的邻居有：${neighbors}。` : '',
    rumors.length ? `最近村里流传的事：${rumors.join('；')}。` : '',
    places.length ? `你听人说起过附近这些地方（方向和距离都是真的）：${places.map((q) => placeLine(q, 'zh')).join('；')}。` : '',
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
    places.length ? '  5. 对方问起宝藏、探险或者附近有什么好玩的地方时，从上面挑一个地方告诉他（方向和距离要说对，再提醒一句那儿的危险），同时用action rumor写上那个地方，玩家的屏幕上就会标出它。' : '',
    '回复格式：只输出一个JSON对象，不要任何别的文字：',
    '{"say":"你说的话","mood":"happy|sad|angry|scared|surprised|neutral","action":null}',
    `action可以是：{"type":"quest","want":"wheat","count":10,"reward":"emerald","rewardCount":3}、{"type":"gift","item":"bread","count":2}、{"type":"discount","pct":10}、{"type":"follow","seconds":60}${places.length ? `、{"type":"rumor","place":"${places[0].k}"}（place只能是${places.map((q) => q.k).join('、')}之一）` : ''}。物品用括号前面的英文名。`,
  ] : [
    'You are playing a villager in Lumencraft, a block game much like Minecraft. Speak in the first person, casually, like a real person chatting, in English.',
    `Who you are: ${p.full.en}${p.name.en !== p.full.en ? `, known as "${p.name.en}"` : ''}, ${p.gender}, ${{ young: 'young', middle: 'middle-aged', old: 'old' }[p.age]}, the village ${job[1]} (${job[3]}). Character: ${traits}. You ${quirk}. Your pet phrase is "${catchOf(p, 'en')}" (now and then, not every time).`,
    `Your village is in a ${clip(ctx.biome || 'plains', 16)}. It is the ${phaseWords(ctx, false)} of day ${day + 1}, ${weatherWords(ctx, false)}. ${danger}`,
    neighbors ? `Your neighbours: ${neighbors}.` : '',
    rumors.length ? `Village gossip lately: ${rumors.join('; ')}.` : '',
    places.length ? `You have heard of these places round about (the directions and distances are true): ${places.map((q) => placeLine(q, 'en')).join('; ')}.` : '',
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
    places.length ? '  5. When asked about treasure, adventures or anything worth seeing round about, tell them of one of the places above (get the direction and distance right, and warn them of its dangers), with the action rumor naming it: the place then shows on their screen.' : '',
    'Answer format: output one JSON object and nothing else:',
    '{"say":"what you say","mood":"happy|sad|angry|scared|surprised|neutral","action":null}',
    `action may be: {"type":"quest","want":"wheat","count":10,"reward":"emerald","rewardCount":3}, {"type":"gift","item":"bread","count":2}, {"type":"discount","pct":10}, {"type":"follow","seconds":60}${places.length ? `, {"type":"rumor","place":"${places[0].k}"} (place one of ${places.map((q) => q.k).join(', ')})` : ''}. Use the item names before the brackets.`,
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

// Something a villager wants to do, checked against what it may do. state: { job, rec, day,
// places (what it knows of round about) }. Returns the action as it will be carried out, or null.
export function cleanAction(a, { job = 'none', rec = null, day = 0, places = [] } = {}) {
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
    case 'rumor': {
      // (only a place that is really there: the game marks it on the player's screen)
      const p = (places || []).find((q) => q && q.k === a.place);
      return p ? { type: 'rumor', place: p.k } : null;
    }
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
  ['treasure', /宝藏|宝贝|宝物|宝箱|寻宝|藏宝|好玩的地方|哪里好玩|哪儿好玩|附近有什么|有什么地方|神殿|遗迹|府邸|矿井|要塞|探险|冒险|treasure|explor|adventure|temple|ruins?\b|mansion|mineshaft|stronghold|where should i go|anything interesting|interesting place|worth seeing|\bloot\b/i],
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
    treasure: ['{catch}，听说{place}。{tip}', '我跟你说个秘密：{place}。{tip}', '想去探险？{place}。{tip}', '我爷爷说过，{place}。{tip}'],
    trip: {
      lift: ['哇啊啊！我们飞起来了！', '抱紧我！地面越来越远了！', '{catch}，这、这是要去{place}吗？'],
      space: ['天哪……那个蓝色的大球就是我们住的地方吗？', '好黑啊，星星好多！', '{catch}，我是全村第一个上天的村民！'],
      arrive: ['我们到{place}啦？我要跟全村人讲！', '这里的地面怎么是这个颜色……', '{player}，你真了不起！'],
      home: ['终于回家了！还是地球最好。', '回来啦！我要跟全村讲我去过太空！', '{player}，下次还带我去！'],
      stay: ['飞碟？我、我还是在这儿等你吧！', '我恐高，就在下面看着你飞！'],
    },
    treasureNone: ['附近？除了田就是树，没听说有什么好玩的地方。', '我从没出过村子，外面有什么我可不知道。'],
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
    treasure: ['{catch}, I hear there\'s {place}. {tip}', 'Here\'s a secret: there\'s {place}. {tip}', 'Fancy an adventure? There\'s {place}. {tip}', 'My grandad always said there\'s {place}. {tip}'],
    trip: {
      lift: ['Waaah! We\'re flying!', 'Hold on to me! The ground\'s getting smaller!', '{catch}, are we really going to {place}?'],
      space: ['Goodness... is that big blue ball where we live?', 'It\'s so dark, and so many stars!', '{catch}, I\'m the first villager ever to go to the sky!'],
      arrive: ['Are we on {place}? Wait till I tell the village!', 'Why is the ground that colour here...', '{player}, you\'re amazing!'],
      home: ['Home at last! There\'s nowhere like the Earth.', 'We\'re back! Wait till the village hears I\'ve been to space!', '{player}, take me again next time!'],
      stay: ['A flying saucer? I-I\'ll wait for you here!', 'I\'m scared of heights. I\'ll watch from down here!'],
    },
    treasureNone: ['Round here? Fields and trees. Never heard of anything worth seeing.', 'I\'ve never been out of the village. No idea what\'s out there.'],
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
    player: clip(playerName, 16) || (zh ? '朋友' : 'friend'), catch: catchOf(p, lang), quirk: quirkText(p, lang, 'i'),
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
  if (event === 'trip') {
    const [stage, to] = tripOf(input.itemName);
    return say(T.trip[stage], stage === 'stay' ? 'scared' : stage === 'home' ? 'happy' : 'surprised', null, { place: TRIP_PLACES[to] ? TRIP_PLACES[to][zh ? 0 : 1] : '' });
  }
  const intent = intentOf(line);
  const night = ctx.phase === 'night' || ctx.time === '晚上' || ctx.time === 'night';
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
      if (rumors.length) return say(T.newsSome, 'surprised', null, { rumor: bare(rumorText(pick(rnd, rumors.slice(-5)), lang, day)) });
      return say(T.newsNone);
    case 'treasure': {
      // (the nearest place mostly, now and then another)
      const places = cleanPlaces(ctx.places);
      if (!places.length) return say(T.treasureNone);
      const at = rnd() < 0.65 ? places[0] : pick(rnd, places);
      return say(T.treasure, 'surprised', { type: 'rumor', place: at.k }, { place: placeLine(at, lang), tip: placeTip(at.k, lang) });
    }
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

// A trip in a flying saucer, as a game tells a villager carried along of it: 'stage:where'.
export const TRIP_STAGES = ['lift', 'space', 'arrive', 'home', 'stay'];
const TRIP_PLACES = { earth: ['地球', 'the Earth'], moon: ['月球', 'the Moon'], mars: ['火星', 'Mars'], jupiter: ['木星的空间站', 'the Jupiter station'], saturn: ['土星的空间站', 'the Saturn station'] };
export function tripOf(s) {
  const [stage, to] = String(s || '').split(':');
  return [TRIP_STAGES.includes(stage) ? stage : 'lift', TRIP_PLACES[to] ? to : 'moon'];
}
export function tripNote(s, who, lang) {
  const [stage, to] = tripOf(s);
  const zh = lang === 'zh';
  const place = TRIP_PLACES[to][zh ? 0 : 1];
  if (zh) return { lift: `${who}抱着你坐进了一个会飞的大飞碟，正喷着火往天上飞，要去${place}`, space: `你们坐着飞碟飞出了天空，到了漆黑的太空里，能看见整个世界变成一个大球，正在去${place}的路上`, arrive: `飞碟刚刚降落在${place}，你是第一个来这里的村民`, home: `你们坐着飞碟从太空回到了地球，刚刚降落`, stay: `${who}要坐飞碟去${place}，想带上你` }[stage];
  return { lift: `${who} is carrying you in a great flying saucer, roaring up into the sky with fire under it, on the way to ${place}`, space: `the saucer has flown right out of the sky into the black of space; you can see the whole world as a ball, on the way to ${place}`, arrive: `the saucer has just landed on ${place}; you are the first villager ever to come here`, home: `the saucer has brought you back from space to the Earth; it has just landed`, stay: `${who} wants to take you with them in a flying saucer to ${place}` }[stage];
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

// ---------------------------------------------------------------- what a villager sees happen
// A word for something it saw: a friend coming by, a monster seen off, its house knocked about,
// a storm, someone dropping out of the sky (from space, on wings, a long fall, a flying saucer),
// a place it told of found.
const REACT = {
  zh: {
    friend: ['{player}！我的好朋友来啦！', '嘿，{player}！见到你真高兴！', '{player}，快过来，我正想你呢！', '哟，这不是{player}嘛！'],
    cheer: ['好样的，{player}！', '太厉害了！把它打跑了！', '哇！{player}是我们村的英雄！', '谢谢你保护我们！', '打得好！再来一个！'],
    house: ['喂！那是我家！', '别拆我的房子！', '哎呀，我家的墙！', '你在我家这儿捣什么乱呢？', '住手！我好不容易才盖起来的！'],
    storm: ['要打雷了，快回家！', '雷公发火了，我得躲起来！', '这么大的雨，快进屋吧！', '哎呀，衣服还晾在外面呢！'],
    space: ['哇！你是从星星上掉下来的吗？', '天哪，你从天上下来的！', '你去过星星那里？快给我讲讲！', '那么高的地方，你不怕吗？'],
    glide: ['哇，你会飞！像鸟一样！', '那对翅膀是哪儿来的？我也想要！', '刚才那是你在天上飞吗？'],
    fall: ['天上掉下来一个人！', '哎哟，摔疼了没有？', '你是从哪儿掉下来的？'],
    saucer: ['那、那是什么大飞盘？！', '天上来了个会发光的大锅盖！', '你是从那个飞盘里出来的？', '我的妈呀，它还会喷火！'],
    found: ['你真找到{place}啦？我就说吧！', '{place}！你去过啦？里面有什么？', '我就知道你能找到{place}！'],
  },
  en: {
    friend: ['{player}! My good friend!', 'Hey, {player}! Lovely to see you!', '{player}, come here, I was just thinking of you!', 'Well, if it isn\'t {player}!'],
    cheer: ['Well done, {player}!', 'Brilliant! You saw it off!', 'Wow! {player}\'s the village hero!', 'Thank you for protecting us!', 'Great shot! Do it again!'],
    house: ['Hey! That\'s my house!', 'Don\'t knock my house down!', 'Oh no, my wall!', 'What are you doing to my house?', 'Stop that! It took me ages to build!'],
    storm: ['Thunder! Get home, quick!', 'The sky\'s angry, I\'m hiding!', 'Look at that rain, get indoors!', 'Oh no, my washing\'s still out!'],
    space: ['Wow! Did you fall from the stars?', 'Goodness, you came down from the sky!', 'You\'ve been up to the stars? Tell me everything!', 'Weren\'t you scared, up so high?'],
    glide: ['Wow, you can fly! Like a bird!', 'Where did you get those wings? I want some!', 'Was that you up in the sky just now?'],
    fall: ['Someone fell out of the sky!', 'Ouch, are you hurt?', 'Where did you fall from?'],
    saucer: ['Wh-what is that great flying dish?!', 'A glowing pot lid came down from the sky!', 'Did you come out of that flying saucer?', 'Goodness me, it breathes fire!'],
    found: ['You really found the {place}? Told you so!', 'The {place}! You went? What was inside?', 'I knew you\'d find the {place}!'],
  },
};
export const REACT_KINDS = Object.keys(REACT.zh);
export function reactLine(kind, { lang, playerName = '', place = '', rnd = Math.random } = {}) {
  const list = REACT[lang === 'zh' ? 'zh' : 'en'][kind];
  if (!list) return '';
  return clip(fill(pick(rnd, list), { player: clip(playerName, 16) || (lang === 'zh' ? '朋友' : 'friend'), place: place ? placeName(place, lang).replace(/^another /, '') : '' }), 80);
}

// ---------------------------------------------------------------- two villagers talking
// A few lines between two neighbours who meet: from the model, or scripted. Lines are
// [who (0: a, 1: b), what they say, mood].
// input: { a, b: personas, lang, ctx, rumors, day, player: a name (someone listening) }
const AGES = { young: ['年轻人', 'young'], middle: ['中年人', 'middle-aged'], old: ['老人', 'old'] };
function sketch(p, zh) {
  const job = JOBS[p.job] || JOBS.none;
  const traits = p.traits.map((k) => TRAITS[k][zh ? 0 : 1]).join(zh ? '、' : ', ');
  const quirk = QUIRKS[p.quirk % QUIRKS.length][zh ? 0 : 1];
  return zh
    ? `${p.name.zh}（${p.gender === 'male' ? '男' : '女'}，${AGES[p.age][0]}，${job[0]}，${traits}，${quirk}，口头禅“${catchOf(p, 'zh')}”）`
    : `${p.name.en} (${p.gender}, ${AGES[p.age][1]}, the ${job[1]}, ${traits}; ${quirk}; says "${catchOf(p, 'en')}" now and then)`;
}
export function buildDialogueMessages(input) {
  const { a, b, lang } = input;
  const zh = lang === 'zh';
  const ctx = input.ctx || {};
  const day = input.day | 0;
  const rumors = (input.rumors || []).slice(-5).map((r) => rumorText(r, lang, day)).filter(Boolean);
  const places = cleanPlaces(ctx.places).slice(0, 2).map((q) => placeLine(q, lang));
  const player = clip(input.player, 16);
  const danger = ctx.danger > 0 ? (zh ? `附近有${ctx.danger}个怪物在转悠。` : `There are ${ctx.danger} monsters prowling nearby.`) : '';
  const lines = zh ? [
    '你在为《光影方块世界》（一个和《我的世界》很像的方块游戏）写村子里的一小段闲聊：两个村民碰上了，站着聊几句。',
    `A：${sketch(a, true)}`,
    `B：${sketch(b, true)}`,
    `村子在${clip(ctx.biome || '平原', 12)}，现在是第${day + 1}天的${phaseWords(ctx, true)}，${weatherWords(ctx, true)}。${danger}`,
    rumors.length ? `村里最近在传：${rumors.join('；')}。` : '',
    places.length ? `他们听说过：${places.join('；')}。` : '',
    player ? `玩家“${player}”就在旁边，听得见他们说话（可以提到他，但别跟他说话）。` : '',
    '',
    '要求：',
    '- 写3到6句，A和B轮流说，A先开口；每句不超过30个字，口语化，像真的邻居唠嗑，符合各自的性格、职业和怪癖。',
    '- 聊点具体的：活计、天气、村里的传闻、邻居、怪物、远处的地方、自己的小毛病……可以拌嘴、开玩笑、说八卦，结尾自然。',
    '- 只知道方块世界里的事；内容适合小朋友；不提AI。',
    '只输出一个JSON对象，不要别的文字：{"lines":[{"who":"A","say":"……","mood":"happy"},{"who":"B","say":"……","mood":"neutral"}]}',
    'mood只能是happy、sad、angry、scared、surprised、neutral之一。',
  ] : [
    'You are writing a little exchange in a village in Lumencraft, a block game much like Minecraft: two villagers meet and stop for a chat.',
    `A: ${sketch(a, false)}`,
    `B: ${sketch(b, false)}`,
    `The village is in a ${clip(ctx.biome || 'plains', 16)}; it is the ${phaseWords(ctx, false)} of day ${day + 1}, ${weatherWords(ctx, false)}. ${danger}`,
    rumors.length ? `Village gossip lately: ${rumors.join('; ')}.` : '',
    places.length ? `They have heard of: ${places.join('; ')}.` : '',
    player ? `A player called "${player}" is standing near and can hear them (they may mention them, but don't talk to them).` : '',
    '',
    'Rules:',
    '- Three to six lines, A and B taking turns, A first; each line at most 20 words, casual, like real neighbours chatting, true to their characters, trades and quirks.',
    '- Talk about something definite: work, the weather, village gossip, the neighbours, monsters, far-off places, their own little foibles... they may bicker, joke or gossip; end naturally.',
    '- They only know the block world; keep it suitable for children; never mention AI.',
    'Output one JSON object and nothing else: {"lines":[{"who":"A","say":"...","mood":"happy"},{"who":"B","say":"...","mood":"neutral"}]}',
    'mood is one of happy, sad, angry, scared, surprised, neutral.',
  ];
  return [{ role: 'system', content: lines.filter((x) => x !== '').join('\n') }, { role: 'user', content: zh ? '写这段对话。' : 'Write the conversation.' }];
}

// The model's conversation: [[who, say, mood], ...] (2 to 6 lines), or null.
export function parseDialogue(text) {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  const k = s.indexOf('['), l = s.lastIndexOf(']');
  let o = null;
  try { o = i >= 0 && j > i && (k < 0 || i < k) ? JSON.parse(s.slice(i, j + 1)) : k >= 0 && l > k ? JSON.parse(s.slice(k, l + 1)) : null; } catch (e) { return null; }
  const list = o && Array.isArray(o.lines) ? o.lines : Array.isArray(o) ? o : null;
  if (!list) return null;
  return cleanDialogue(list.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? [/^\s*b\s*$/i.test(String(x.who)) || x.who === 1 ? 1 : 0, x.say, x.mood] : x)));
}
// lines as sent (by a server, from a model): checked and trimmed
export function cleanDialogue(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const x of list.slice(0, 8)) {
    if (!Array.isArray(x) || typeof x[1] !== 'string') continue;
    const say = clip(x[1], 90);
    if (say) out.push([x[0] === 1 ? 1 : 0, say, MOODS.includes(x[2]) ? x[2] : 'neutral']);
  }
  return out.length >= 2 ? out.slice(0, 6) : null;
}

const D = {
  zh: {
    open: { morning: ['早啊，{b}！', '{b}，起这么早？'], day: ['{b}，忙啥呢？', '哟，{b}！'], evening: ['{b}，吃了没？', '{b}，收工啦？'], night: ['{b}，还不睡？', '嘘，{b}，你也睡不着？'] },
    reply: ['{catch}，是{a}啊！', '哎，{a}！', '嗯呐，你也在呀。', '是{a}啊，正想找你呢。'],
    rumor: ['你听说了吗？{rumor}。', '我跟你说，{rumor}！', '{catch}，听说{rumor}。'],
    rumorBack: [['真的假的？', 'surprised'], ['天哪！', 'surprised'], ['我早就听说啦。', 'neutral'], ['这可是大新闻！', 'surprised'], ['啧啧，真不得了。', 'happy']],
    place: ['我听人说，{place}。', '{catch}，你知道吗？{place}。'],
    placeBack: [['那么远？我可不敢去。', 'scared'], ['真的？哪天咱们一起去看看？', 'happy'], ['可别乱跑，外面有怪物！', 'scared']],
    quirk: ['我跟你说，我{quirk}。', '不瞒你说，我{quirk}。'],
    quirkBack: [['你都说了八百遍啦！', 'happy'], ['哈哈，我知道我知道。', 'happy'], ['真的吗？头一回听说。', 'surprised']],
    work: ['今天活儿可真多。', '我得赶紧把手头的活儿干完。', '最近生意还不错。'],
    workBack: [['那敢情好。', 'happy'], ['别累着自己。', 'neutral'], ['我也是，忙得团团转。', 'neutral']],
    weather: { rain: [['这雨下个没完。', 'sad'], ['地里的庄稼倒是高兴了。', 'happy']], storm: [['打雷了，好吓人！', 'scared'], ['快回屋吧！', 'scared']], snow: [['下雪了，冷死了。', 'sad'], ['回家烤火去！', 'happy']] },
    danger: [['附近好像有怪物，你听见了吗？', 'scared'], ['嘘！别出声，快躲起来。', 'scared']],
    player: [['你看，{player}又来了。', 'happy'], ['{player}这人挺好的，上回还跟我打招呼。', 'happy']],
    close: [['好了，我得干活去了。', '回见！'], ['不说了，回家吃饭去。', '慢走！'], ['走了走了。', '嗯，回头聊。'], ['下回再聊！', '好嘞！']],
  },
  en: {
    open: { morning: ['Morning, {b}!', 'Up early, {b}?'], day: ['Busy, {b}?', 'Oh, hello {b}!'], evening: ['Had your supper, {b}?', 'Finished for the day, {b}?'], night: ['Still up, {b}?', 'Shh, {b}, can\'t you sleep either?'] },
    reply: ['{catch}, it\'s {a}!', 'Oh, {a}!', 'Hello there.', '{a}! I was hoping to see you.'],
    rumor: ['Did you hear? {rumor}.', 'Guess what: {rumor}!', '{catch}, word is {rumor}.'],
    rumorBack: [['No! Really?', 'surprised'], ['Goodness!', 'surprised'], ['I heard that already.', 'neutral'], ['Now that\'s news!', 'surprised'], ['Well I never.', 'happy']],
    place: ['Someone told me there\'s {place}.', '{catch}, did you know there\'s {place}?'],
    placeBack: [['That far? Not for me.', 'scared'], ['Really? Shall we go and look one day?', 'happy'], ['Don\'t go wandering, there are monsters out there!', 'scared']],
    quirk: ['I tell you, I {quirk}.', 'Between you and me, I {quirk}.'],
    quirkBack: [['You\'ve told me a hundred times!', 'happy'], ['Ha, I know, I know.', 'happy'], ['Really? First I\'ve heard of it.', 'surprised']],
    work: ['So much to do today.', 'I must get on with my work.', 'Business is good lately.'],
    workBack: [['Glad to hear it.', 'happy'], ['Don\'t wear yourself out.', 'neutral'], ['Me too, run off my feet.', 'neutral']],
    weather: { rain: [['This rain won\'t stop.', 'sad'], ['The crops are happy, at least.', 'happy']], storm: [['Thunder! How frightening!', 'scared'], ['Get indoors, quick!', 'scared']], snow: [['Snow! I\'m freezing.', 'sad'], ['Home to the fire, then!', 'happy']] },
    danger: [['I think there are monsters about. Did you hear that?', 'scared'], ['Shh! Quiet, let\'s hide.', 'scared']],
    player: [['Look, {player}\'s here again.', 'happy'], ['{player}\'s all right. Said hello to me last time.', 'happy']],
    close: [['Right, back to work.', 'See you!'], ['Must dash, supper\'s waiting.', 'Take care!'], ['Off I go.', 'Talk later.'], ['Next time, then!', 'Next time!']],
  },
};
export function offlineDialogue({ a, b, lang, ctx = {}, rumors = [], day = 0, player = '', rnd = Math.random }) {
  const zh = lang === 'zh';
  const T = D[zh ? 'zh' : 'en'];
  const name = (p) => personaName(p, lang);
  const vars = (p, extra = {}) => ({ a: name(a), b: name(b), catch: catchOf(p, lang), quirk: quirkText(p, lang, 'i'), player: clip(player, 16) || (zh ? '那个外乡人' : 'that stranger'), ...extra });
  const out = [];
  const line = (who, text, mood, extra) => out.push([who, clip(fill(text, vars(who ? b : a, extra)), 90), mood]);
  const both = (pair) => { line(0, pair[0][0], pair[0][1]); line(1, pair[1][0], pair[1][1]); };
  const open = T.open[ctx.phase] || T.open.day;
  line(0, pick(rnd, open), 'happy');
  line(1, pick(rnd, T.reply), 'happy');
  // something to talk about: what's going on first, then whatever comes to mind
  const topics = [];
  if (ctx.danger > 0) topics.push(() => both(T.danger));
  if (T.weather[ctx.weather]) topics.push(() => both(T.weather[ctx.weather]));
  if (rumors.length) topics.push(() => { line(0, pick(rnd, T.rumor), 'surprised', { rumor: bare(rumorText(pick(rnd, rumors.slice(-5)), lang, day)) }); const r = pick(rnd, T.rumorBack); line(1, r[0], r[1]); });
  const places = cleanPlaces(ctx.places);
  if (places.length && rnd() < 0.6) topics.push(() => { line(0, pick(rnd, T.place), 'surprised', { place: placeLine(pick(rnd, places), lang) }); const r = pick(rnd, T.placeBack); line(1, r[0], r[1]); });
  if (player && rnd() < 0.35) topics.push(() => both(T.player.map((x) => [x[0], x[1]])));
  const filler = [
    () => { line(0, pick(rnd, T.quirk), 'neutral'); const r = pick(rnd, T.quirkBack); line(1, r[0], r[1]); },
    () => { const p = chatterPair(lang, rnd); line(0, p[0], 'neutral'); line(1, p[1], 'happy'); },
    () => { line(0, pick(rnd, T.work), 'neutral'); const r = pick(rnd, T.workBack); line(1, r[0], r[1]); },
  ];
  const chosen = topics.length ? [topics[0]] : [];
  while (chosen.length < 1 + (rnd() < 0.35 ? 1 : 0)) chosen.push(filler.splice(Math.floor(rnd() * filler.length), 1)[0]);
  for (const f of chosen) f();
  if (out.length < 6 && rnd() < 0.6) { const c = pick(rnd, T.close); line(0, c[0], 'neutral'); line(1, c[1], 'happy'); }
  return out.slice(0, 6);
}
