/**
 * Иконки — тонкие stroke-SVG в 1.5px, под стиль «документ».
 * Заменяют emoji (эмодзи в интерфейсе — признак того, что иконографию не рисовали).
 * Все иконки наследуют цвет и размер через currentColor / prop size.
 */
type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconCheck = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 8.5 6.2 12 13 4" />
  </svg>
);

export const IconCross = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const IconDownload = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M8 2v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
  </svg>
);

export const IconBell = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M8 2a4 4 0 0 0-4 4v2.2L2.8 11h10.4L12 8.2V6a4 4 0 0 0-4-4ZM6.4 13a1.7 1.7 0 0 0 3.2 0" />
  </svg>
);

export const IconBack = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9.5 3.5 5 8l4.5 4.5" />
  </svg>
);

export const IconDoc = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 2h5l3 3v9H4zM9 2v3h3M6 8.5h4M6 11h4" />
  </svg>
);

export const IconCard = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="2" y="3.5" width="12" height="9" rx="1" />
    <path d="M2 6.5h12M4.5 9.5h3" />
  </svg>
);

export const IconPin = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M8 14s4.5-4.2 4.5-7.2A4.5 4.5 0 0 0 8 2.3a4.5 4.5 0 0 0-4.5 4.5C3.5 9.8 8 14 8 14Z" />
    <circle cx="8" cy="6.8" r="1.6" />
  </svg>
);

export const IconCalendar = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </svg>
);

export const IconSearch = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 14 14" />
  </svg>
);
