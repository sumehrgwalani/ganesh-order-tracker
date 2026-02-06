import React from 'react';
import { getContactInfo } from '../utils/helpers';

function ContactAvatar({ email, size = 'md' }) {
  const contact = getContactInfo(email);
  const sizeClasses = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' };
  return (
    <div className={`${sizeClasses[size]} ${contact.color} rounded-full flex items-center justify-center text-white font-medium flex-shrink-0`}>
      {contact.initials}
    </div>
  );
}

export default ContactAvatar;
