interface AppVersionProps {
  className?: string;
}

export const AppVersion = ({ className = "text-xs text-gray-400" }: AppVersionProps) => {
  // Get version from build-time constant
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

  return (
    <div className={className} title="Application version">
      v{version}
    </div>
  );
};