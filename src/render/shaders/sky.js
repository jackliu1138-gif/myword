// Sky-view LUT: physically based scattering for sun and moon, rendered at low resolution.
import { HEADER, FRAME_UBO, UTIL, ATMOSPHERE, SKY_LUT } from './common.js';

export const skyLutFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${ATMOSPHERE}
${SKY_LUT}
in vec2 vUV;
out vec4 oColor;
uniform float uSunIntensity;
uniform float uMoonIntensity;
void main() {
  vec3 dir = skyLutDir(vUV);
  float camAlt = 150.0 + max(uCamPos.y - 50.0, 0.0) * 2.0;
  vec3 col = vec3(0.0);
  if (uSunDir.y > -0.35) col += atmosScatter(dir, uSunDir.xyz, camAlt, 28) * uSunIntensity;
  if (uMoonDir.y > -0.2) col += atmosScatter(dir, uMoonDir.xyz, camAlt, 14) * uMoonIntensity * vec3(0.72, 0.84, 1.15);
  // faint airglow so moonless nights are not pitch black
  col += vec3(0.00035, 0.00055, 0.0011) * uMoonDir.w * (1.0 - 0.6 * saturate(dir.y));
  // multiple scattering keeps a daytime horizon white-blue rather than yellow; approximate that
  float horizon = 1.0 - smoothstep(0.0, 0.3, abs(dir.y));
  float lit = max(smoothstep(0.04, 0.35, uSunDir.y), smoothstep(0.04, 0.35, uMoonDir.y) * (1.0 - smoothstep(-0.2, 0.0, uSunDir.y)) * 1.4);
  col = mix(col, vec3(luma(col)) * vec3(0.9, 0.97, 1.1), min(0.4 * horizon * lit, 0.7));
  // single scattering underestimates sky radiance; scale into balance with the terrain lighting
  oColor = vec4(col * 1.7, 1.0);
}
`;
