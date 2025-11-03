import React from 'react';

interface IconProps {
  className?: string;
  size?: number;
}

export const SnacksIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8h16v12H4V8z"/>
    <path d="M4 8l2-4h12l2 4"/>
    <path d="M8 14h8"/>
    <circle cx="10" cy="18" r="1" fill="currentColor"/>
    <circle cx="14" cy="18" r="1" fill="currentColor"/>
  </svg>
);

export const ToysIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="8" width="18" height="12" rx="2"/>
    <path d="M12 8V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v4"/>
    <path d="M16 4a2 2 0 0 1 2 2v2"/>
    <circle cx="8" cy="14" r="1.5" fill="currentColor"/>
    <circle cx="16" cy="14" r="1.5" fill="currentColor"/>
    <path d="M12 14v6"/>
  </svg>
);

export const CraftsIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    <path d="M12 19l-2-2"/>
  </svg>
);

export const GamesIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="12" height="16" rx="2"/>
    <circle cx="12" cy="8" r="1.5" fill="currentColor"/>
    <path d="M8 12h8"/>
    <path d="M10 15h4"/>
    <circle cx="12" cy="18" r="1"/>
  </svg>
);

export const BooksIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
    <path d="M9 10h6"/>
    <path d="M9 14h6"/>
  </svg>
);

export const ClothesIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z"/>
  </svg>
);

export const EntertainmentIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="2"/>
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    <circle cx="12" cy="12" r="2"/>
    <path d="M6 12h.01M18 12h.01"/>
  </svg>
);

export const SportsIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    <path d="M12 3v18"/>
  </svg>
);

export const SchoolIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
    <path d="M6 12v5c3 3 9 3 12 0v-5"/>
  </svg>
);

export const OtherIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 6v6"/>
    <path d="M12 16h.01"/>
  </svg>
);

// Icon component map for easier usage
export const CategoryIconMap = {
  snacks: SnacksIcon,
  toys: ToysIcon,
  crafts: CraftsIcon,
  games: GamesIcon,
  books: BooksIcon,
  clothes: ClothesIcon,
  entertainment: EntertainmentIcon,
  sports: SportsIcon,
  school: SchoolIcon,
  other: OtherIcon,
};

export type CategoryIconType = keyof typeof CategoryIconMap;