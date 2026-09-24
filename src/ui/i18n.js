// Interface language: English and Simplified Chinese.
// t('key', { name: value }) looks a string up in the current language and fills {name} slots.
// Static markup is translated through data-i18n (text), data-i18n-html (trusted markup) and
// data-i18n-attr ("placeholder:key; aria-label:key") attributes.

const DICT = {
  en: {
    'app.name': 'Lumencraft',
    'lang.en': 'English',
    'lang.zh': '中文',

    // title
    'title.eyebrow': 'Voxel sandbox · WebGL 2',
    'title.tagline': 'An endless blocky world with a physically based sky, soft shadows, volumetric clouds and water that reflects it all.',
    'title.play': 'Play',
    'title.continue': 'Continue',
    'title.new': 'New world',
    'title.settings': 'Settings',
    'title.help': 'Controls',
    'title.device': 'Device check',
    'title.quickstart': 'Quick start',
    'title.meta': 'Seed {seed} · {state}',
    'title.savedWorld': 'saved world',
    'title.newWorld': 'new world',
    'title.language': 'Language',

    // pause
    'pause.title': 'Paused',
    'pause.resume': 'Resume',
    'pause.toTitle': 'Save and go to title',

    // settings
    'settings.title': 'Settings',
    'settings.hint': 'Changes apply immediately.',
    'settings.done': 'Done',
    'tab.general': 'General',
    'tab.graphics': 'Graphics',
    'tab.world': 'World',
    'tab.controls': 'Controls',
    'tab.sound': 'Sound',
    'set.language': 'Language',
    'set.preset': 'Quality preset',
    'set.preset.desc': 'Lite is made for phones and projectors. Ultra doubles shadow resolution and renders at full display density.',
    'preset.lite': 'Lite',
    'preset.low': 'Low',
    'preset.medium': 'Medium',
    'preset.high': 'High',
    'preset.ultra': 'Ultra',
    'preset.custom': 'Custom',
    'set.renderDistance': 'Render distance',
    'set.renderScale': 'Resolution scale',
    'set.dynamicRes': 'Dynamic resolution',
    'set.dynamicRes.desc': 'Lowers the resolution while the frame rate drops, and raises it again when there is headroom.',
    'set.targetFps': 'Target frame rate',
    'set.shadows': 'Soft shadows',
    'set.shadows.desc': 'Sun and moon shadows with contact hardening.',
    'set.clouds': 'Volumetric clouds',
    'set.clouds.desc': 'Raymarched cumulus that also shade the ground.',
    'set.volumetric': 'God rays',
    'set.volumetric.desc': 'Light shafts through leaves, fog and water.',
    'set.ssr': 'Water reflections',
    'set.ssr.desc': 'Screen-space reflections of terrain on water.',
    'set.ssao': 'Ambient occlusion',
    'set.ssao.desc': 'Extra contact shading between plants and blocks.',
    'set.bloom': 'Bloom',
    'set.bloom.desc': 'Glow around the sun, torches and bright sky.',
    'set.taa': 'Temporal anti-aliasing',
    'set.taa.desc': 'Smooth edges and stable shimmer; off uses FXAA.',
    'set.weather': 'Weather',
    'set.weather.desc': 'Changing brings rain now and then, with the odd thunderstorm. Deserts stay dry; cold biomes get snow.',
    'weather.auto': 'Changing',
    'weather.clear': 'Clear',
    'weather.rain': 'Rain',
    'weather.storm': 'Storm',
    'set.timeOfDay': 'Time of day',
    'set.dayLength': 'Day length',
    'set.cloudCoverage': 'Cloud cover',
    'set.brightness': 'Brightness',
    'set.fov': 'Field of view',
    'set.sensitivity': 'Mouse sensitivity',
    'set.invertY': 'Invert vertical look',
    'set.viewBobbing': 'View bobbing',
    'set.autoJump': 'Auto-jump',
    'set.autoJump.desc': 'Step up single blocks while walking into them.',
    'set.padSensitivity': 'Controller look speed',
    'set.padInvertY': 'Controller: invert vertical look',
    'set.padVibration': 'Controller vibration',
    'set.touchSize': 'Touch button size',
    'set.touchOpacity': 'Touch button opacity',
    'set.touchSensitivity': 'Touch look speed',
    'set.touchHaptics': 'Vibrate on touch actions',
    'set.touchHaptics.desc': 'Short buzzes when you break or place blocks (Android).',
    'set.volume': 'Volume',
    'set.ambience': 'Ambient sounds',
    'set.ambience.desc': 'Wind, birds by day, crickets at night.',
    'unit.chunks': '{n} chunks',
    'unit.minutes': '{n} min',
    'unit.fps': '{n} fps',

    // help
    'help.title': 'Controls',
    'help.back': 'Back',
    'help.keyboard': 'Keyboard and mouse',
    'help.gamepad': 'Controller',
    'help.touch': 'Touch screen',
    'help.remote': 'In menus, a TV remote works too: arrows to move, OK to choose, Back to return.',
    'key.leftClick': 'Left click',
    'key.rightClick': 'Right click',
    'key.middleClick': 'Middle click',
    'key.mouse': 'Mouse',
    'key.wheel': 'wheel',
    'key.or': 'or',
    'act.walk': 'Walk',
    'act.look': 'Look around',
    'act.jump': 'Jump, swim up, fly up',
    'act.toggleFly': 'Toggle flying',
    'act.sneak': 'Sneak, fly down',
    'act.sprint': 'Sprint',
    'act.break': 'Break (hold to keep breaking)',
    'act.place': 'Place',
    'act.pick': "Pick the block you're looking at",
    'act.hotbar': 'Choose hotbar slot',
    'act.inventory': 'Open all blocks',
    'act.fastTime': 'Hold to fast-forward the day',
    'act.debug': 'Debug info',
    'act.hideHud': 'Hide the interface',
    'act.pause': 'Pause',
    'act.move': 'Move',
    'act.moveSprint': 'Move (click to sprint)',
    'act.jumpFly': 'Jump · twice to fly',
    'act.breakBlock': 'Break block',
    'act.placeBlock': 'Place block',
    'act.allBlocks': 'All blocks',
    'act.holdTime': 'Hold to speed up time',
    'pad.leftStick': 'Left stick',
    'pad.rightStick': 'Right stick',
    'pad.dpad': 'D-pad',
    'pad.menu': 'Menu',
    'pad.view': 'View',
    'act.lookPick': 'Look (click to pick block)',
    'act.hotbarPad': 'Previous / next slot',
    'act.menuNav': 'In menus: D-pad or stick to move, A to choose, B to go back, LB / RB to switch tabs',
    'touch.stick': 'Left stick',
    'touch.stickDesc': 'Move; push to the edge to sprint',
    'touch.drag': 'Drag',
    'touch.dragDesc': 'Look around',
    'touch.tap': 'Tap',
    'touch.tapDesc': 'Place a block',
    'touch.hold': 'Hold',
    'touch.holdDesc': 'Break a block',
    'touch.hotbar': 'Hotbar',
    'touch.hotbarDesc': 'Tap a slot to select it',
    'touch.buttons': 'Buttons',
    'touch.buttonsDesc': 'Jump, sneak, fly, break, place, blocks, pause',
    'touch.jump': 'Jump',
    'touch.sneak': 'Sneak or fly down',
    'touch.fly': 'Toggle flying',
    'touch.flyLabel': 'FLY',
    'touch.inventory': 'Blocks',
    'touch.pause': 'Pause',
    'touch.break': 'Break',
    'touch.place': 'Place',
    'touch.fullscreen': 'Full screen',
    'touch.rotate': 'Turn your phone sideways for the best view',

    // new world
    'new.title': 'New world',
    'new.hint': 'This replaces the world you have now, including everything you built.',
    'new.seed': 'Seed (leave empty for a random one)',
    'new.placeholder': 'e.g. lighthouse',
    'new.cancel': 'Cancel',
    'new.create': 'Create world',

    // inventory
    'inv.title': 'Blocks',
    'inv.hint': 'Choose a block to put it in the selected hotbar slot. E closes.',

    // loading & errors
    'load.title': 'Shaping terrain',
    'load.sub': 'Generating chunks…',
    'load.chunks': '{ready} / {total} chunks near you',
    'err.title': "Can't start the renderer",
    'err.hint': 'Lumencraft needs WebGL 2 with floating-point render targets. Recent Chrome, Edge, Firefox and Safari support it; check that hardware acceleration is turned on.',
    'err.contextLost': 'The graphics context was lost (the GPU was reset or ran out of memory). Your world was saved; reload the page to continue.',
    'err.noWebgl2': 'This browser does not support WebGL 2.',
    'err.noFloat': 'This GPU cannot render to floating-point textures.',

    // HUD & toasts
    'hud.lockHint': 'Click to look around',
    'hud.dragHint': 'Drag with the mouse to look around',
    'hud.gameView': 'Game view',
    'hud.hotbar': 'Hotbar',
    'toast.newWorld': 'New world created',
    'toast.time': 'Time {time}',
    'toast.autoQuality': 'Running at {fps} fps, switched graphics to {preset}. Change it in Settings.',
    'toast.error': 'Something went wrong: {msg}',
    'toast.padConnected': 'Controller connected: {name}',
    'toast.padDisconnected': 'Controller disconnected',

    // device check
    'dev.title': 'Device check',
    'dev.hint': 'Take a screenshot of this page if something does not work, and send it along with your description.',
    'dev.browser': 'Browser',
    'dev.screen': 'Screen',
    'dev.gpu': 'Graphics',
    'dev.webgl2': 'WebGL 2',
    'dev.floatTargets': 'Float render targets',
    'dev.maxTexture': 'Max texture size',
    'dev.cores': 'CPU threads',
    'dev.memory': 'Memory',
    'dev.touch': 'Touch screen',
    'dev.gamepads': 'Controllers',
    'dev.gamepadsNone': 'None found. Connect one and press any button.',
    'dev.fps': 'Frame rate',
    'dev.preset': 'Quality preset',
    'dev.resolution': 'Render resolution',
    'dev.audio': 'Web Audio',
    'dev.storage': 'Saving',
    'dev.yes': 'Yes',
    'dev.no': 'No',
    'dev.recommend': 'Suggested preset: {preset}',
    'dev.back': 'Back',

    // debug overlay
    'dbg.cpu': 'cpu',
    'dbg.facing': 'facing',
    'dbg.dirs': 'north (-Z)|east (+X)|south (+Z)|west (-X)',
    'dbg.biome': 'Biome',
    'dbg.light': 'light sky {sky} block {block}',
    'dbg.time': 'Time',
    'dbg.weather': 'weather',
    'dbg.flying': 'flying',
    'dbg.swimming': 'swimming',
    'dbg.onGround': 'on ground',
    'dbg.airborne': 'airborne',
    'dbg.chunks': 'Chunks {loaded} loaded, {drawn} drawn, {shadow} in shadow pass',
    'dbg.render': 'Render {size}  preset {preset}  shadows {shadows}',
    'dbg.off': 'off',
    'dbg.seed': 'Seed',

    biomes: 'Ocean|Beach|Plains|Forest|Birch Forest|Taiga|Snowy Taiga|Desert|Mountains|River',
  },

  zh: {
    'app.name': 'Lumencraft',
    'lang.en': 'English',
    'lang.zh': '中文',

    'title.eyebrow': '方块沙盒 · WebGL 2',
    'title.tagline': '一个无边无际的方块世界：基于物理的天空、柔和阴影、体积云，还有倒映着这一切的水面。',
    'title.play': '开始游戏',
    'title.continue': '继续游戏',
    'title.new': '新建世界',
    'title.settings': '设置',
    'title.help': '操作说明',
    'title.device': '设备检测',
    'title.quickstart': '快速上手',
    'title.meta': '种子 {seed} · {state}',
    'title.savedWorld': '已保存的世界',
    'title.newWorld': '新世界',
    'title.language': '语言',

    'pause.title': '已暂停',
    'pause.resume': '继续',
    'pause.toTitle': '保存并返回标题',

    'settings.title': '设置',
    'settings.hint': '修改会立即生效。',
    'settings.done': '完成',
    'tab.general': '通用',
    'tab.graphics': '画面',
    'tab.world': '世界',
    'tab.controls': '操作',
    'tab.sound': '声音',
    'set.language': '语言',
    'set.preset': '画质预设',
    'set.preset.desc': '"流畅"专为手机和投影仪设计；"极致"使用双倍阴影分辨率，并按屏幕原生像素密度渲染。',
    'preset.lite': '流畅',
    'preset.low': '低',
    'preset.medium': '中',
    'preset.high': '高',
    'preset.ultra': '极致',
    'preset.custom': '自定义',
    'set.renderDistance': '视野距离',
    'set.renderScale': '分辨率比例',
    'set.dynamicRes': '动态分辨率',
    'set.dynamicRes.desc': '帧率下降时自动降低分辨率，性能有余量时再升回来。',
    'set.targetFps': '目标帧率',
    'set.shadows': '柔和阴影',
    'set.shadows.desc': '日光和月光的阴影，离物体越近越清晰。',
    'set.clouds': '体积云',
    'set.clouds.desc': '光线步进渲染的积云，还会在地面投下云影。',
    'set.volumetric': '体积光（丁达尔效应）',
    'set.volumetric.desc': '穿过树叶、雾气和水面的光束。',
    'set.ssr': '水面反射',
    'set.ssr.desc': '在水面上倒映出地形（屏幕空间反射）。',
    'set.ssao': '环境光遮蔽',
    'set.ssao.desc': '让植物与方块的接触处更有阴影层次。',
    'set.bloom': '泛光',
    'set.bloom.desc': '太阳、火把和明亮天空周围的光晕。',
    'set.taa': '时间抗锯齿（TAA）',
    'set.taa.desc': '边缘更平滑、画面不闪烁；关闭后改用 FXAA。',
    'set.weather': '天气',
    'set.weather.desc': '"多变"会不时下雨，偶尔还有雷暴。沙漠不下雨，寒冷地区会下雪。',
    'weather.auto': '多变',
    'weather.clear': '晴天',
    'weather.rain': '下雨',
    'weather.storm': '雷暴',
    'set.timeOfDay': '时间',
    'set.dayLength': '一天时长',
    'set.cloudCoverage': '云量',
    'set.brightness': '亮度',
    'set.fov': '视野角度',
    'set.sensitivity': '鼠标灵敏度',
    'set.invertY': '反转上下视角',
    'set.viewBobbing': '走路时镜头晃动',
    'set.autoJump': '自动跳跃',
    'set.autoJump.desc': '走向一格高的方块时自动跳上去。',
    'set.padSensitivity': '手柄视角速度',
    'set.padInvertY': '手柄：反转上下视角',
    'set.padVibration': '手柄震动',
    'set.touchSize': '触屏按钮大小',
    'set.touchOpacity': '触屏按钮不透明度',
    'set.touchSensitivity': '触屏视角速度',
    'set.touchHaptics': '触屏震动反馈',
    'set.touchHaptics.desc': '挖掘和放置方块时轻微震动（安卓）。',
    'set.volume': '音量',
    'set.ambience': '环境音',
    'set.ambience.desc': '风声，白天的鸟叫，夜晚的虫鸣。',
    'unit.chunks': '{n} 个区块',
    'unit.minutes': '{n} 分钟',
    'unit.fps': '{n} 帧',

    'help.title': '操作说明',
    'help.back': '返回',
    'help.keyboard': '键盘和鼠标',
    'help.gamepad': '手柄',
    'help.touch': '触屏',
    'help.remote': '在菜单里也可以用电视遥控器：方向键移动，确认键选择，返回键后退。',
    'key.leftClick': '鼠标左键',
    'key.rightClick': '鼠标右键',
    'key.middleClick': '鼠标中键',
    'key.mouse': '鼠标',
    'key.wheel': '滚轮',
    'key.or': '或',
    'act.walk': '移动',
    'act.look': '转动视角',
    'act.jump': '跳跃、上浮、向上飞',
    'act.toggleFly': '开关飞行',
    'act.sneak': '潜行、向下飞',
    'act.sprint': '疾跑',
    'act.break': '挖掘（按住连续挖）',
    'act.place': '放置',
    'act.pick': '选取准星对着的方块',
    'act.hotbar': '选择物品栏格子',
    'act.inventory': '打开方块栏',
    'act.fastTime': '按住让时间快进',
    'act.debug': '调试信息',
    'act.hideHud': '隐藏界面',
    'act.pause': '暂停',
    'act.move': '移动',
    'act.moveSprint': '移动（按下摇杆疾跑）',
    'act.jumpFly': '跳跃 · 连按两次飞行',
    'act.breakBlock': '挖掘方块',
    'act.placeBlock': '放置方块',
    'act.allBlocks': '全部方块',
    'act.holdTime': '按住加快时间',
    'pad.leftStick': '左摇杆',
    'pad.rightStick': '右摇杆',
    'pad.dpad': '方向键',
    'pad.menu': '菜单键',
    'pad.view': '视图键',
    'act.lookPick': '视角（按下选取方块）',
    'act.hotbarPad': '上一格 / 下一格',
    'act.menuNav': '菜单中：方向键或摇杆移动，A 确认，B 返回，LB / RB 切换标签页',
    'touch.stick': '左侧摇杆',
    'touch.stickDesc': '移动；推到边缘就是疾跑',
    'touch.drag': '滑动',
    'touch.dragDesc': '转动视角',
    'touch.tap': '轻点',
    'touch.tapDesc': '放置方块',
    'touch.hold': '长按',
    'touch.holdDesc': '挖掘方块',
    'touch.hotbar': '物品栏',
    'touch.hotbarDesc': '点一下格子就能选中',
    'touch.buttons': '按钮',
    'touch.buttonsDesc': '跳跃、潜行、飞行、挖掘、放置、方块栏、暂停',
    'touch.jump': '跳跃',
    'touch.sneak': '潜行或向下飞',
    'touch.fly': '开关飞行',
    'touch.flyLabel': '飞',
    'touch.inventory': '方块栏',
    'touch.pause': '暂停',
    'touch.break': '挖掘',
    'touch.place': '放置',
    'touch.fullscreen': '全屏',
    'touch.rotate': '横过手机来玩效果更好',

    'new.title': '新建世界',
    'new.hint': '这会替换掉你现在的世界，包括你建造的一切。',
    'new.seed': '种子（留空则随机）',
    'new.placeholder': '例如：灯塔',
    'new.cancel': '取消',
    'new.create': '创建世界',

    'inv.title': '方块',
    'inv.hint': '选择一个方块，放进当前选中的物品栏格子。按 E 关闭。',

    'load.title': '正在塑造地形',
    'load.sub': '正在生成区块…',
    'load.chunks': '附近区块 {ready} / {total}',
    'err.title': '无法启动渲染器',
    'err.hint': 'Lumencraft 需要支持浮点渲染目标的 WebGL 2。新版 Chrome、Edge、Firefox 和 Safari 都支持；请确认已开启硬件加速。',
    'err.contextLost': '图形上下文丢失了（显卡被重置或显存不足）。你的世界已保存，刷新页面即可继续。',
    'err.noWebgl2': '这个浏览器不支持 WebGL 2。',
    'err.noFloat': '这块显卡不支持渲染到浮点纹理。',

    'hud.lockHint': '点击画面来转动视角',
    'hud.dragHint': '按住鼠标拖动来转动视角',
    'hud.gameView': '游戏画面',
    'hud.hotbar': '物品栏',
    'toast.newWorld': '新世界已创建',
    'toast.time': '时间 {time}',
    'toast.autoQuality': '当前帧率 {fps}，已把画质切换为"{preset}"。可以在设置里修改。',
    'toast.error': '出错了：{msg}',
    'toast.padConnected': '手柄已连接：{name}',
    'toast.padDisconnected': '手柄已断开',

    'dev.title': '设备检测',
    'dev.hint': '如果遇到问题，把这个页面截图发给我，并描述一下情况。',
    'dev.browser': '浏览器',
    'dev.screen': '屏幕',
    'dev.gpu': '显卡',
    'dev.webgl2': 'WebGL 2',
    'dev.floatTargets': '浮点渲染目标',
    'dev.maxTexture': '最大纹理尺寸',
    'dev.cores': 'CPU 线程数',
    'dev.memory': '内存',
    'dev.touch': '触摸屏',
    'dev.gamepads': '手柄',
    'dev.gamepadsNone': '没有检测到。连接手柄后随便按一个键。',
    'dev.fps': '帧率',
    'dev.preset': '画质预设',
    'dev.resolution': '渲染分辨率',
    'dev.audio': 'Web Audio 音频',
    'dev.storage': '存档',
    'dev.yes': '支持',
    'dev.no': '不支持',
    'dev.recommend': '建议画质：{preset}',
    'dev.back': '返回',

    'dbg.cpu': 'CPU',
    'dbg.facing': '朝向',
    'dbg.dirs': '北 (-Z)|东 (+X)|南 (+Z)|西 (-X)',
    'dbg.biome': '生物群系',
    'dbg.light': '天空光 {sky} 方块光 {block}',
    'dbg.time': '时间',
    'dbg.weather': '天气',
    'dbg.flying': '飞行中',
    'dbg.swimming': '游泳中',
    'dbg.onGround': '在地面',
    'dbg.airborne': '空中',
    'dbg.chunks': '区块：已加载 {loaded}，绘制 {drawn}，阴影 {shadow}',
    'dbg.render': '渲染 {size}  画质 {preset}  阴影 {shadows}',
    'dbg.off': '关',
    'dbg.seed': '种子',

    biomes: '海洋|沙滩|平原|森林|白桦林|针叶林|积雪针叶林|沙漠|山地|河流',
  },
};

export const LANGUAGES = ['zh', 'en'];
let current = 'en';
const listeners = new Set();

export function detectLanguage() {
  try {
    const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (const l of langs) {
      const s = String(l).toLowerCase();
      if (s.startsWith('zh')) return 'zh';
      if (s.startsWith('en')) return 'en';
    }
  } catch (e) { /* ignore */ }
  return 'en';
}

export function getLanguage() {
  return current;
}

// Adds strings from another module (entities, villagers, multiplayer...).
export function registerStrings(lang, entries) {
  Object.assign(DICT[lang] || (DICT[lang] = {}), entries);
}

export function t(key, vars) {
  let s = DICT[current][key];
  if (s === undefined) s = DICT.en[key];
  if (s === undefined) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
  return s;
}

// A list stored as "a|b|c".
export function tList(key) {
  return t(key).split('|');
}

export function blockName(d) {
  if (!d) return '';
  return current === 'zh' && d.zh ? d.zh : d.name;
}

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}

export function setLanguage(lang) {
  if (!DICT[lang]) lang = 'en';
  current = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    applyI18n(document);
  }
  for (const fn of listeners) fn(lang);
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
