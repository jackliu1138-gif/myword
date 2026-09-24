// Weather: clear spells, rain and thunderstorms, with smooth transitions and drying ground.

export const WEATHER_MODES = ['auto', 'clear', 'rain', 'storm'];

export class Weather {
  constructor() {
    this.rain = 0; // precipitation intensity 0..1 (smoothed)
    this.storm = 0; // thunderstorm factor 0..1 (smoothed)
    this.wetness = 0; // how wet exposed surfaces are; dries slowly after rain
    this.target = 0;
    this.stormTarget = 0;
    this.timer = 300 + Math.random() * 420; // first rain comes after a while
    this.flash = 0;
    this.flashT = 0;
    this.nextStrike = 4;
    this.thunderQueue = [];
  }

  update(dt, mode, onThunder) {
    if (mode === 'clear') { this.target = 0; this.stormTarget = 0; }
    else if (mode === 'rain') { this.target = 1; this.stormTarget = 0; }
    else if (mode === 'storm') { this.target = 1; this.stormTarget = 1; }
    else {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.target > 0) {
          this.target = 0;
          this.stormTarget = 0;
          this.timer = 360 + Math.random() * 540; // 6..15 minutes of fair weather
        } else {
          this.target = 0.75 + Math.random() * 0.25;
          this.stormTarget = Math.random() < 0.35 ? 1 : 0;
          this.timer = 150 + Math.random() * 240; // 2.5..6.5 minutes of rain
        }
      }
    }
    // clouds build up and clear over roughly a minute
    const k = 1 - Math.exp(-dt / 22);
    this.rain += (this.target - this.rain) * k;
    this.storm += (this.stormTarget - this.storm) * k;
    if (this.rain > this.wetness) this.wetness += (this.rain - this.wetness) * (1 - Math.exp(-dt / 12));
    else this.wetness += (this.rain - this.wetness) * (1 - Math.exp(-dt / 70));

    // lightning: a bright double flash, thunder follows after the sound's travel time
    if (this.storm > 0.55 && this.rain > 0.6) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = 5 + Math.random() * 16;
        this.flashT = 0.6;
        const distance = 0.15 + Math.random() * 0.85;
        this.flashScale = 1.3 - distance * 0.8;
        this.thunderQueue.push({ t: 0.3 + distance * 3.5, distance });
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const a = 0.6 - this.flashT;
      // two quick pulses
      this.flash = Math.max(0, (Math.exp(-a * 20) + 0.7 * Math.exp(-Math.abs(a - 0.18) * 30)) * (this.flashScale || 1));
    } else this.flash = 0;
    for (const th of this.thunderQueue) th.t -= dt;
    while (this.thunderQueue.length && this.thunderQueue[0].t <= 0) {
      const th = this.thunderQueue.shift();
      if (onThunder) onThunder(th.distance);
    }
  }

  describe() {
    if (this.rain < 0.05) return 'clear';
    return (this.storm > 0.5 ? 'storm ' : 'rain ') + Math.round(this.rain * 100) + '%';
  }
}
