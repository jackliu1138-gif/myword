// Rain streaks and snowflakes: instanced quads in a box around the camera that wraps as it moves,
// hidden under roofs using a top-down height map of the surrounding columns.
import { HEADER, FRAME_UBO, UTIL } from './common.js';

export const precipVS = `${HEADER}
${FRAME_UBO}
${UTIL}
layout(location = 0) in vec2 aCorner; // x -1..1 across, y 0..1 along the streak
layout(location = 1) in vec4 aSeed;   // per instance
uniform vec4 uBox;       // x radius, y height, z fall speed, w streak length
uniform vec4 uStyle;     // x width, y snow, zw wind
uniform sampler2D uOcclusion;
uniform vec2 uOccOrigin;
out vec2 vCorner;
out float vFade;
out float vVisible;
void main() {
  float R = uBox.x, Hh = uBox.y;
  vec3 cam = uCamPos.xyz;
  float t = uCamPos.w;
  float snow = uStyle.y;
  // world-anchored column inside a box that wraps around the camera
  vec2 xz = cam.xz - R + mod(aSeed.xy * 2.0 * R - (cam.xz - R), 2.0 * R);
  float fall = uBox.z * (0.8 + 0.4 * aSeed.w);
  float y = cam.y - Hh * 0.5 + mod(aSeed.z * Hh - t * fall - (cam.y - Hh * 0.5), Hh);
  vec3 p = vec3(xz.x, y, xz.y);
  if (snow > 0.5) {
    p.x += sin(t * 1.3 + aSeed.z * 40.0) * 0.4;
    p.z += cos(t * 1.1 + aSeed.w * 40.0) * 0.4;
  }
  // roofs and tree canopies stop the rain
  vec2 ouv = (floor(p.xz) - uOccOrigin + 0.5) / 64.0;
  float top = texture(uOcclusion, ouv).r * 255.0;
  bool inside = ouv.x > 0.0 && ouv.x < 1.0 && ouv.y > 0.0 && ouv.y < 1.0;
  vVisible = inside && p.y < top + 1.0 ? 0.0 : 1.0;
  vec3 toCam = vec3(p.x - cam.x, 0.0, p.z - cam.z);
  float d = length(toCam);
  toCam /= max(d, 1e-3);
  vec3 right = vec3(-toCam.z, 0.0, toCam.x);
  vec3 v;
  if (snow > 0.5) {
    vec3 up = vec3(uView[0][1], uView[1][1], uView[2][1]);
    vec3 rt = vec3(uView[0][0], uView[1][0], uView[2][0]);
    v = p + rt * aCorner.x * uStyle.x + up * (aCorner.y * 2.0 - 1.0) * uStyle.x;
  } else {
    vec3 along = normalize(vec3(uStyle.z, fall, uStyle.w));
    v = p + right * aCorner.x * uStyle.x + along * aCorner.y * uBox.w;
  }
  vFade = smoothstep(R, R * 0.55, d) * smoothstep(0.4, 1.6, d);
  vCorner = aCorner;
  gl_Position = uViewProj * vec4(v - cam, 1.0);
}
`;

export const precipFS = `${HEADER}
${FRAME_UBO}
${UTIL}
uniform vec4 uStyle;
uniform float uIntensity;
in vec2 vCorner;
in float vFade;
in float vVisible;
out vec4 oColor;
void main() {
  if (vVisible < 0.5) discard;
  bool snow = uStyle.y > 0.5;
  float a;
  if (snow) {
    vec2 q = vec2(vCorner.x, vCorner.y * 2.0 - 1.0);
    a = smoothstep(1.0, 0.25, length(q));
  } else {
    a = (1.0 - abs(vCorner.x)) * smoothstep(0.0, 0.25, vCorner.y) * smoothstep(1.0, 0.55, vCorner.y);
  }
  a *= vFade * uIntensity;
  if (a < 0.004) discard;
  float sky = uParams2.w;
  vec3 col = uSkyColor.rgb * (snow ? 1.1 : 0.55) * (0.3 + 0.7 * sky) + uLightColor.rgb * 0.06
           + vec3(0.7, 0.75, 0.95) * uWeather.z * 2.5;
  float alpha = a * (snow ? 0.95 : 0.5);
  oColor = vec4(col * alpha, alpha);
}
`;
