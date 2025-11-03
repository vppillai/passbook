import React from 'react';

interface IconProps {
  className?: string;
  size?: number;
}

export const SnacksIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2c-5.5 0-10 4.5-10 10s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" fill="currentColor" opacity="0.15"/>
    <path d="M12 2C6.5 2 2 6.5 2 12c0 5.5 4.5 10 10 10"/>
    <circle cx="9" cy="10" r="1" fill="currentColor"/>
    <circle cx="15" cy="10" r="1" fill="currentColor"/>
    <circle cx="10" cy="14" r="0.8" fill="currentColor"/>
    <circle cx="14" cy="14" r="0.8" fill="currentColor"/>
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
    <circle cx="8" cy="16" r="3" fill="currentColor" opacity="0.3"/>
    <path d="M8 16v6"/>
    <path d="M8 16c0-2 1-4 4-4s4 2 4 4"/>
    <line x1="16" y1="4" x2="21" y2="1" strokeWidth="2"/>
    <line x1="18" y1="6" x2="22" y2="3" strokeWidth="2"/>
    <circle cx="16" cy="4" r="1.5" fill="currentColor"/>
    <circle cx="21" cy="1" r="1" fill="currentColor"/>
  </svg>
);

export const GamesIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="2"/>
    <path d="M6 12h4"/>
    <path d="M8 10v4"/>
    <circle cx="16" cy="11" r="1.5" fill="currentColor"/>
    <circle cx="19" cy="13" r="1.5" fill="currentColor"/>
    <path d="M9 18h6"/>
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
    <ellipse cx="12" cy="12" rx="10" ry="7"/>
    <path d="M12 5v14"/>
    <path d="M2 12c0 3.86 4.48 7 10 7s10-3.14 10-7"/>
    <path d="M12 5C7.03 5 3 7.24 3 10"/>
    <path d="M12 19c4.97 0 9-2.24 9-5"/>
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