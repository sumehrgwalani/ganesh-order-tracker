import React from 'react';
import { LOGO_URL, GI_LOGO_URL } from '../data/constants';

function WTTLogo({ size = 40 }) {
  return (
    <img
      src={LOGO_URL}
      alt="withthetide"
      width={size}
      height={size}
      className="rounded-full object-cover"
      style={{ minWidth: size, minHeight: size }}
    />
  );
}

function GILogo({ size = 60 }) {
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
