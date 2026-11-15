/**
 * Decorative hero artwork, split into two pieces so it stays responsive:
 * `SkyScene` anchors to the top of the hero (sunburst, clouds, gulls) and
 * `SeaScene` anchors to the bottom (lighthouse, boat, water, dock railing).
 * Both are purely presentational and hidden from assistive technology.
 *
 * In `SeaScene` the lighthouse and boat are drawn *before* the water so the
 * opaque water rectangle cuts them off at the waterline.
 */

const WATER_LINE = 196;

function Cloud({ x, y, s = 1, o = 0.95 }: { x: number; y: number; s?: number; o?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={o} fill="#ffffff">
      <ellipse cx="0" cy="0" rx="46" ry="30" />
      <ellipse cx="44" cy="10" rx="36" ry="23" />
      <ellipse cx="-42" cy="12" rx="32" ry="20" />
      <rect x="-44" y="6" width="92" height="26" rx="13" />
    </g>
  );
}

function Gull({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 0c6-8 13-8 18 0c5-8 12-8 18 0"
      fill="none"
      stroke="#ffffff"
      strokeWidth="3"
      strokeLinecap="round"
    />
  );
}

/**
 * Clouds and gulls only. The sunburst is a masked conic gradient on `.hero`
 * itself (see styles.css) so it scales to any hero size without hard edges.
 */
export function SkyScene() {
  return (
    <svg
      className="scene scene-sky"
      viewBox="0 0 1440 400"
      preserveAspectRatio="xMidYMin slice"
      aria-hidden="true"
      focusable="false"
    >
      <Cloud x={1288} y={186} s={1.15} />
      <Cloud x={1104} y={252} s={0.78} o={0.9} />
      <Cloud x={1430} y={274} s={0.9} o={0.85} />
      <Cloud x={112} y={276} s={0.72} o={0.8} />

      <g opacity="0.95">
        <Gull x={168} y={132} s={1.15} />
        <Gull x={244} y={188} s={0.85} />
        <Gull x={1218} y={104} s={1} />
        <Gull x={1304} y={148} s={0.78} />
      </g>
    </svg>
  );
}

function Fish({
  x,
  y,
  s = 1,
  c,
  flip = false,
}: {
  x: number;
  y: number;
  s?: number;
  c: string;
  flip?: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`} fill={c}>
      <ellipse cx="9" cy="0" rx="11" ry="6" />
      <path d="M-2 0l-10-7v14z" />
      <circle cx="16" cy="-1.6" r="1.4" fill="#123243" />
    </g>
  );
}

function School({ x, y, s, c }: { x: number; y: number; s: number; c: string }) {
  const cells: Array<[number, number]> = [
    [0, 0],
    [34, -14],
    [34, 14],
    [68, 0],
    [68, -28],
    [102, -14],
    [102, 16],
  ];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {cells.map(([dx, dy]) => (
        <Fish key={`${dx}-${dy}`} x={dx} y={dy} c={c} />
      ))}
    </g>
  );
}

/** Sits on rocks at the left; the water rectangle hides everything below y=196. */
function Lighthouse() {
  return (
    <g transform="translate(168 0)">
      {/* rocky islet, waterline cuts it at y=196 */}
      <path d="M-6 194l40-36 30 20 28-26 38 32 44 26v30H-6z" fill="#59687a" />
      <path d="M30 198l30-26 26 16 28-20 32 30v26H30z" fill="#75858f" />
      {/* tower */}
      <path d="M56 226L76 70h32l20 156z" fill="#f8fbfd" />
      <path d="M128 226L108 70h-7l18 156z" fill="#dbe7ee" />
      <path d="M70 116h44l3 22H67z" fill="#e05a52" />
      <path d="M62 176h60l2 22H60z" fill="#e05a52" />
      {/* gallery + lantern room */}
      <rect x="60" y="58" width="64" height="13" rx="4" fill="#3f5666" />
      <rect x="76" y="28" width="32" height="30" fill="#ffdf7a" />
      <rect x="90" y="28" width="4" height="30" fill="#3f5666" opacity="0.45" />
      <path d="M70 28h44L92 10z" fill="#3f5666" />
      <rect x="89" y="2" width="6" height="9" rx="3" fill="#3f5666" />
      {/* door + window */}
      <rect x="84" y="180" width="16" height="20" rx="8" fill="#3f5666" />
      <circle cx="92" cy="152" r="5" fill="#9fb4c2" />
    </g>
  );
}

/** Floats mid-scene; the hull below y=196 is covered by the water. */
function Boat() {
  return (
    <g transform="translate(560 92)">
      {/* oar resting across the gunwale */}
      <g transform="rotate(-8 200 40)">
        <rect x="48" y="36" width="312" height="9" rx="4.5" fill="#8a5a30" />
        <path d="M360 30h32c9 0 9 21 0 21h-32z" fill="#8a5a30" />
      </g>
      {/* hull */}
      <path d="M2 46h396c-14 76-72 116-198 116S16 122 2 46z" fill="#b3773f" />
      <path d="M18 56h364c-12 62-64 96-182 96S30 118 18 56z" fill="#c58a4f" />
      <path d="M44 78h312c-10 42-52 66-156 66S54 120 44 78z" fill="#a06c33" opacity="0.3" />
      {/* gunwale + thwarts */}
      <rect x="-6" y="34" width="412" height="17" rx="8.5" fill="#96602f" />
      <rect x="92" y="60" width="118" height="15" rx="6" fill="#96602f" />
      <rect x="236" y="74" width="104" height="13" rx="6" fill="#96602f" />
      <rect x="60" y="52" width="280" height="6" rx="3" fill="#8a5a30" opacity="0.35" />
    </g>
  );
}

/** Leaping: drawn before the water so the tail end stays submerged. */
function Dolphin() {
  return (
    <g transform="translate(1252 150) rotate(-26)" fill="#8ea7b8">
      <path d="M-52 4l-30-22 6 22-6 24z" />
      <ellipse cx="0" cy="0" rx="56" ry="18" />
      <path d="M40 -12c14 0 22 6 24 12c-6 5-16 7-26 6z" />
      <path d="M-2 -14l14-28 14 28z" />
      <path d="M0 14l24 20-4-21z" />
      <ellipse cx="6" cy="8" rx="40" ry="9" fill="#cfdde6" />
      <circle cx="38" cy="-5" r="2.6" fill="#2b4453" />
    </g>
  );
}

/**
 * `band` crops to the water + railing, a short divider used whenever the hero
 * carries real UI (an inbox, the auth form) and must stay near the top.
 */
export function SeaScene({ band = false }: { band?: boolean }) {
  const posts = Array.from({ length: 14 }, (_, i) => 14 + i * 110);
  return (
    <svg
      className={band ? 'scene scene-sea band' : 'scene scene-sea'}
      viewBox={band ? '0 292 1440 188' : '0 0 1440 480'}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id="water"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1={WATER_LINE}
          x2="0"
          y2="480"
        >
          <stop offset="0" stopColor="#8ad5f8" />
          <stop offset="0.5" stopColor="#65bdee" />
          <stop offset="1" stopColor="#4ea9e3" />
        </linearGradient>
      </defs>

      {/* above the waterline */}
      <Lighthouse />
      <Boat />
      <Dolphin />

      {/* water, painted over the submerged parts */}
      <rect x="0" y={WATER_LINE} width="1440" height={480 - WATER_LINE} fill="url(#water)" />
      <rect x="0" y={WATER_LINE} width="1440" height="4" fill="#ffffff" opacity="0.45" />
      <g stroke="#ffffff" strokeOpacity="0.4" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M60 232q30-12 60 0t60 0M330 250q30-12 60 0t60 0M900 236q30-12 60 0t60 0M1160 276q30-12 60 0t60 0M150 344q30-12 60 0t60 0M1000 358q30-12 60 0t60 0M520 300q30-12 60 0t60 0" />
      </g>

      {/* underwater life */}
      <School x={150} y={296} s={0.85} c="#f08a76" />
      <School x={1024} y={264} s={0.9} c="#f08a76" />
      <School x={168} y={410} s={0.7} c="#f08a76" />
      <Fish x={196} y={244} s={1.5} c="#4f7fbe" />
      <Fish x={124} y={352} s={1.2} c="#f4c250" />
      <Fish x={520} y={368} s={1.2} c="#f4c250" />
      <Fish x={868} y={318} s={1.4} c="#f4c250" flip />
      <Fish x={924} y={396} s={1.6} c="#4f7fbe" flip />

      {/* dock railing, in front of everything */}
      <g fill="#a9713f">
        <rect x="0" y="356" width="1440" height="15" />
        <rect x="0" y="404" width="1440" height="11" opacity="0.92" />
        {posts.map((x) => (
          <g key={x}>
            <rect x={x} y="344" width="15" height="136" rx="3" />
            <rect x={x} y="344" width="15" height="8" rx="3" fill="#c58a4f" />
          </g>
        ))}
        <rect x="0" y="356" width="1440" height="4" fill="#c58a4f" />
      </g>
    </svg>
  );
}
