import React from 'react';

export function Icon({ name, size = 18 }) {
  const paths = {
    pulse: (
      <>
        <path d="M3 12h4l2.2-6 4.1 12 2.1-6H21" />
      </>
    ),
    overview: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="5" rx="1.5" />
        <rect x="13" y="10" width="8" height="11" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
      </>
    ),
    monitors: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9h10M7 13h6M7 17h3" />
      </>
    ),
    incidents: (
      <>
        <path d="m12 3 9 16H3L12 3Z" />
        <path d="M12 9v4m0 3h.01" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1 1.2 1-1.2 2-1.5-.5a8 8 0 0 1-1.6.9l-.3 1.5h-2.4l-.3-1.5a8 8 0 0 1-1.6-.9l-1.5.5-1.2-2 1.2-1a7 7 0 0 1 0-1.9l-1.2-1 1.2-2 1.5.5a8 8 0 0 1 1.6-.9l.3-1.5h2.4l.3 1.5a8 8 0 0 1 1.6.9l1.5-.5 1.2 2-1.2 1a7 7 0 0 1-.1 1.8Z" />
      </>
    ),
    plus: <path d="M12 5v14m-7-7h14" />,
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5.5 9a7 7 0 0 1 11.7-2L20 12M4 12l2.8 5a7 7 0 0 0 11.7-2" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7V5Z" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    chevron: <path d="m7 10 5 5 5-5" />,
    user: (
      <>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H4" />
        <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      </>
    ),
    close: <path d="m18 6-12 12M6 6l12 12" />,
    arrow: (
      <>
        <path d="M7 17 17 7M7 7h10v10" />
      </>
    )
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
