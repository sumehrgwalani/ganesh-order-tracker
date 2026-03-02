/**
 * Normalize a company name to a canonical form.
 * Strips extra spaces, normalizes dots/periods, standardizes common abbreviations.
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return ''
  let n = name.trim()

  // Collapse multiple spaces
  n = n.replace(/\s+/g, ' ')

  // Normalize common suffixes
  n = n.replace(/\bS\s*\.\s*L\s*\.?\b/gi, 'S.L.')
  n = n.replace(/\bPvt\s*\.?\s*Ltd\s*\.?\b/gi, 'Pvt. Ltd.')
  n = n.replace(/\bPrivate\s+Limited\b/gi, 'Pvt. Ltd.')
  n = n.replace(/\bLtd\s*\.?\b/gi, 'Ltd.')
  n = n.replace(/\bInc\s*\.?\b/gi, 'Inc.')
  n = n.replace(/\bCorp\s*\.?\b/gi, 'Corp.')
  n = n.replace(/\bL\s*\.\s*L\s*\.\s*C\s*\.?\b/gi, 'LLC')
  n = n.replace(/\bS\s*\.\s*A\s*\.?\b/gi, 'S.A.')
  n = n.replace(/\bG\s*\.?\s*m\s*\.?\s*b\s*\.?\s*H\s*\.?\b/gi, 'GmbH')

  // Collapse spaces again after replacements
  n = n.replace(/\s+/g, ' ').trim()

  return n
}

/**
 * Find the best matching company name from a list of existing companies.
 * Returns the existing name if a fuzzy match is found, otherwise the normalized input.
 */
export function findMatchingCompany(input: string, existingCompanies: string[]): string {
  const normalized = normalizeCompanyName(input)
  const inputKey = normalized.toLowerCase().replace(/[^a-z0-9]/g, '')

  for (const existing of existingCompanies) {
    const existingKey = existing.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (inputKey === existingKey) return existing
  }

  return normalized
}
