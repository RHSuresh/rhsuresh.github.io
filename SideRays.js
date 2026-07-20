import { Renderer, Program, Geometry, Mesh } from 'https://unpkg.com/ogl@0.0.32/dist/ogl.mjs';

const hexToRgb = hex => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
};

const resolveColor = (colorStr) => {
  if (!colorStr) return '#ffffff';
  colorStr = colorStr.trim();
  if (colorStr.startsWith('var(')) {
    const varName = colorStr.slice(4, -1).trim();
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || '#ffffff';
  }
  return colorStr;
};

const originToFlip = origin => {
  switch (origin) {
    case 'top-left': return [1, 0];
    case 'bottom-right': return [0, 1];
    case 'bottom-left': return [1, 1];
    default: return [0, 0];
  }
};

export function initSideRays(container, options = {}) {
  let {
    speed = 2.5,
    rayColor1 = '#EAB308',
    rayColor2 = '#96c8ff',
    intensity = 2,
    spread = 2,
    origin = 'top-right',
    tilt = 0,
    saturation = 1.5,
    blend = 0.75,
    falloff = 1.6,
    opacity = 1.0
  } = options;

  let isVisible = true; // Initialize to true so it starts rendering immediately on load
  let uniforms = null;
  let renderer = null;
  let animationId = null;
  let mesh = null;
  let gl = null;

  const updateUniformValues = () => {
    if (!uniforms) return;
    const color1Resolved = resolveColor(rayColor1);
    const color2Resolved = resolveColor(rayColor2);
    
    uniforms.iSpeed.value = speed;
    uniforms.iRayColor1.value = hexToRgb(color1Resolved);
    uniforms.iRayColor2.value = hexToRgb(color2Resolved);
    uniforms.iIntensity.value = intensity;
    uniforms.iSpread.value = spread;
    const [flipX, flipY] = originToFlip(origin);
    uniforms.iFlipX.value = flipX;
    uniforms.iFlipY.value = flipY;
    uniforms.iTilt.value = tilt;
    uniforms.iSaturation.value = saturation;
    uniforms.iBlend.value = blend;
    uniforms.iFalloff.value = falloff;
    uniforms.iOpacity.value = opacity;
  };

  const cleanupWebGL = () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    window.removeEventListener('resize', updateSize);
    if (renderer) {
      try {
        const loseCtx = renderer.gl.getExtension('WEBGL_lose_context');
        if (loseCtx) loseCtx.loseContext();
        const canvas = renderer.gl.canvas;
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      } catch (e) {}
    }
    renderer = null;
    uniforms = null;
    mesh = null;
    gl = null;
  };

  const updateSize = () => {
    if (!container || !renderer || !uniforms) return;
    renderer.dpr = Math.min(window.devicePixelRatio, 2);
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h);
    uniforms.iResolution.value = [w * renderer.dpr, h * renderer.dpr];
  };

  const loop = t => {
    if (!renderer || !uniforms || !mesh) return;
    uniforms.iTime.value = t * 0.001;
    try {
      renderer.render({ scene: mesh });
      animationId = requestAnimationFrame(loop);
    } catch (e) {
      return;
    }
  };

  const initializeWebGL = async () => {
    if (!container) return;
    
    // Tiny delay to ensure layout is ready
    await new Promise(resolve => setTimeout(resolve, 10));
    if (!container || !isVisible) return;

    renderer = new Renderer({
      dpr: Math.min(window.devicePixelRatio, 2),
      alpha: true
    });
    gl = renderer.gl;
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(gl.canvas);

    const vert = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

    const frag = `precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform float iSpeed;
uniform vec3 iRayColor1;
uniform vec3 iRayColor2;
uniform float iIntensity;
uniform float iSpread;
uniform float iFlipX;
uniform float iFlipY;
uniform float iTilt;
uniform float iSaturation;
uniform float iBlend;
uniform float iFalloff;
uniform float iOpacity;

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  float cosAngle = dot(normalize(sourceToCoord), rayRefDirection);
  return clamp(
    (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),
    0.0, 1.0) *
    clamp((iResolution.x - length(sourceToCoord)) / iResolution.x, 0.5, 1.0);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  if (iFlipX > 0.5) fragCoord.x = iResolution.x - fragCoord.x;
  if (iFlipY > 0.5) fragCoord.y = iResolution.y - fragCoord.y;

  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 rayPos = vec2(iResolution.x * 1.1, -0.5 * iResolution.y);

  float tiltRad = iTilt * 3.14159265 / 180.0;
  float cs = cos(tiltRad);
  float sn = sin(tiltRad);
  vec2 rel = coord - rayPos;
  vec2 tiltedCoord = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + rayPos;

  float halfSpread = iSpread * 0.275;
  vec2 rayRefDir1 = normalize(vec2(cos(0.785398 + halfSpread), sin(0.785398 + halfSpread)));
  vec2 rayRefDir2 = normalize(vec2(cos(0.785398 - halfSpread), sin(0.785398 - halfSpread)));

  vec4 rays1 = vec4(iRayColor1, 1.0) * rayStrength(rayPos, rayRefDir1, tiltedCoord, 36.2214, 21.11349, iSpeed);
  vec4 rays2 = vec4(iRayColor2, 1.0) * rayStrength(rayPos, rayRefDir2, tiltedCoord, 22.3991, 18.0234, iSpeed * 0.2);

  vec4 color = rays1 * (1.0 - iBlend) * 0.9 + rays2 * iBlend * 0.9;

  float distanceToLight = length(fragCoord.xy - vec2(rayPos.x, iResolution.y - rayPos.y)) / iResolution.y;
  float brightness = iIntensity * 0.4 / pow(max(distanceToLight, 0.001), iFalloff);
  color.rgb *= brightness;

  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(gray), color.rgb, iSaturation);

  color.a = max(color.r, max(color.g, color.b)) * iOpacity;
  gl_FragColor = color;
}`;

    const [flipX, flipY] = originToFlip(origin);
    const color1Resolved = resolveColor(rayColor1);
    const color2Resolved = resolveColor(rayColor2);

    uniforms = {
      iTime: { value: 0 },
      iResolution: { value: [1, 1] },
      iSpeed: { value: speed },
      iRayColor1: { value: hexToRgb(color1Resolved) },
      iRayColor2: { value: hexToRgb(color2Resolved) },
      iIntensity: { value: intensity },
      iSpread: { value: spread },
      iFlipX: { value: flipX },
      iFlipY: { value: flipY },
      iTilt: { value: tilt },
      iSaturation: { value: saturation },
      iBlend: { value: blend },
      iFalloff: { value: falloff },
      iOpacity: { value: opacity }
    };

    // Create full-screen triangle geometry manually since Triangle is not in the default OGL build exports
    const geometry = new Geometry(gl, {
      position: { size: 2, data: new Float32Array([-1, -1, 3, -1, -1, 3]) },
      uv: { size: 2, data: new Float32Array([0, 0, 2, 0, 0, 2]) }
    });

    const program = new Program(gl, { vertex: vert, fragment: frag, uniforms });
    mesh = new Mesh(gl, { geometry, program });

    window.addEventListener('resize', updateSize);
    updateSize();
    animationId = requestAnimationFrame(loop);
  };

  // Run initial WebGL setup synchronously to guarantee load
  initializeWebGL();

  const observer = new IntersectionObserver(
    entries => {
      const entry = entries[0];
      isVisible = entry.isIntersecting;
      if (isVisible) {
        if (!renderer) {
          initializeWebGL();
        }
      } else {
        cleanupWebGL();
      }
    },
    { threshold: 0.0 }
  );

  observer.observe(container);

  // Watch for theme changes to update color uniforms
  const themeObserver = new MutationObserver(() => {
    updateUniformValues();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });

  return {
    updateProps: (newOptions) => {
      if (newOptions.speed !== undefined) speed = newOptions.speed;
      if (newOptions.rayColor1 !== undefined) rayColor1 = newOptions.rayColor1;
      if (newOptions.rayColor2 !== undefined) rayColor2 = newOptions.rayColor2;
      if (newOptions.intensity !== undefined) intensity = newOptions.intensity;
      if (newOptions.spread !== undefined) spread = newOptions.spread;
      if (newOptions.origin !== undefined) origin = newOptions.origin;
      if (newOptions.tilt !== undefined) tilt = newOptions.tilt;
      if (newOptions.saturation !== undefined) saturation = newOptions.saturation;
      if (newOptions.blend !== undefined) blend = newOptions.blend;
      if (newOptions.falloff !== undefined) falloff = newOptions.falloff;
      if (newOptions.opacity !== undefined) opacity = newOptions.opacity;
      updateUniformValues();
    },
    destroy: () => {
      observer.disconnect();
      themeObserver.disconnect();
      cleanupWebGL();
    }
  };
}
