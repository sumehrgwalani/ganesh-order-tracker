import { LOGO_URL, GI_LOGO_URL } from '../data/constants';

interface WTTLogoProps {
  size?: number;
}

interface GILogoProps {
  size?: number;
}

function WTTLogo({ size = 40 }: WTTLogoProps) {
  return (
    <img
      src={LOGO_URL}
      alt="withthetide"
      className="rounded-full object-contain"
      style={{ width: size, height: 'auto' }}
    />
  );
}

function GILogo({ size = 60 }: GILogoProps) {
  return (
    <img
      src={GI_LOGO_URL}
      alt="Ganesh International"
      width={size}
      height={size}
      className="object-contain"
      style={{ minWidth: size, minHeight: size }}
    />
  );
}

export { WTTLogo, GILogo };
