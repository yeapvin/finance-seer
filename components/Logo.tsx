export function FinanceSeerLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="50%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
        <linearGradient id="lineGrad" x1="4" y1="20" x2="28" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#60a5fa" />
        </linearGradient>
        <clipPath id="eyeClip">
          <ellipse cx="16" cy="16" rx="13" ry="8.5" />
        </clipPath>
      </defs>

      {/* Eye outline */}
      <ellipse cx="16" cy="16" rx="13" ry="8.5" stroke="url(#logoGrad)" strokeWidth="1.8" fill="none" />

      {/* Iris */}
      <circle cx="16" cy="16" r="5" fill="none" stroke="url(#logoGrad)" strokeWidth="1.4" opacity="0.7" />

      {/* Pupil dot */}
      <circle cx="16" cy="16" r="1.8" fill="url(#logoGrad)" />

      {/* Chart trend line through the eye */}
      <polyline
        points="4,19 9,17 13,20 17,13 21,15 28,10"
        stroke="url(#lineGrad)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        clipPath="url(#eyeClip)"
      />

      {/* Upward tick at the end */}
      <polyline
        points="25,13 28,10 28,13"
        stroke="url(#lineGrad)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        clipPath="url(#eyeClip)"
      />
    </svg>
  )
}
