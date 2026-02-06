import type { Contact } from '../types';
import { CONTACTS } from '../data/contacts';

export const getContactInfo = (emailStr: string): Contact => {
  if (!emailStr) return { name: 'Unknown', initials: 'UN', color: 'bg-gray-400', company: '', role: '', phone: '', notes: '', country: '' };
  const emailLower = emailStr.toLowerCase();
  for (const [key, value] of Object.entries(CONTACTS)) {
    if (emailLower.includes(key)) return value;
  }
  const match = emailStr.match(/^"?([^"<]+)"?\s*<?/);
  const name = match ? match[1].trim() : emailStr.split('@')[0];
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  return { name, initials, color: 'bg-gray-500', company: '', role: '', phone: '', notes: '', country: '' };
};
